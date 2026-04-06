"""
神临山海 · AI漫剧 引擎对比测试
用 Ch1 核心画面同时调多个 API，对比出图质量

运行：python3 07_AI_Manga/test_engines.py
依赖：pip3 install requests python-dotenv PyJWT
"""
import requests, os, json, sys, time, base64, hashlib
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / "CaptainCast" / ".env")
load_dotenv(override=True)  # 也读当前目录 .env

OUT = Path(__file__).resolve().parent / "test_output"
OUT.mkdir(exist_ok=True)

# ── 测试 Prompt（Ch1 九色渊·麦洛浮出水面）──
PROMPT_CH1 = """A 14-year-old Chinese girl with long black hair emerging from luminous nine-colored water,
eyes still closed, smiling gently in sleep, five different colored water droplets sliding from her hair tips,
each refracting a micro-rainbow. Jade-green crystalline mountains in the background glowing with warm scattered light.
Faint translucent data grid rotating in the highest sky like a cosmic dome.
A tiny silver three-tailed cat-like spirit creature perched on a rock at the shore watching her.
Chinese ink wash painting meets cyberpunk aesthetic,
Dunhuang mural mineral pigment colors,
dominant palette: emerald #3CB371 to amber #FFBF00 to sky blue #87CEEB,
underwater aurora lighting with warm color temperature,
cinematic composition, masterpiece quality, 4K, 16:9 widescreen landscape.
No text, no watermark."""

PROMPT_CH1_INKWASH = """Pure Chinese ink wash style meets cyberpunk: a young girl floating upward through
nine-colored luminous water, eyes closed, peaceful smile. Long black hair spreading like ink strokes in water.
Five colors flow around her — jade green, amber gold, sky blue, soft purple, warm orange —
each color is liquid light, not paint. Mineral jade mountains beyond the water surface glow with scattered light.
Above everything, a semi-transparent geometric data-grid rotates slowly like a cosmic ceiling.
Dunhuang mural mineral pigment quality colors. Traditional shuimo brushwork textures.
Cinematic 16:9 widescreen composition. Masterpiece quality. No text."""


def save_image(data, name):
    """保存图片（支持 bytes 或 URL）"""
    if isinstance(data, bytes):
        img = data
    elif isinstance(data, str) and data.startswith("http"):
        img = requests.get(data, timeout=60).content
    elif isinstance(data, str):  # base64
        img = base64.b64decode(data)
    else:
        print(f"  ✗ 未知数据类型: {type(data)}")
        return
    path = OUT / name
    path.write_bytes(img)
    print(f"  ✅ {path.name} ({len(img)//1024} KB)")


# ═══════════════════════════════════════════
# Engine 1: Gemini (已有，via OpenRouter)
# ═══════════════════════════════════════════
def test_gemini(prompt, suffix=""):
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        print("  ⏭️  OPENROUTER_API_KEY 未设置")
        return
    print("\n🔵 Gemini (OpenRouter)...")
    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": "google/gemini-3.1-flash-image-preview",
                "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
            },
            timeout=120,
            proxies={"https": "http://127.0.0.1:1087", "http": "http://127.0.0.1:1087"}
        )
        data = resp.json()
        msg = data["choices"][0]["message"]
        # 尝试多种格式提取图片
        for field in [msg.get("images", []), msg.get("content") if isinstance(msg.get("content"), list) else []]:
            if not field:
                continue
            for part in field:
                if not isinstance(part, dict):
                    continue
                url = part.get("image_url", {}).get("url", "")
                if url.startswith("data:"):
                    save_image(base64.b64decode(url.split(",")[1]), f"gemini{suffix}.png")
                    return
                elif url.startswith("http"):
                    save_image(url, f"gemini{suffix}.png")
                    return
        # fallback: base64 in content string
        import re
        content = msg.get("content", "")
        if isinstance(content, str):
            m = re.search(r'data:image/\w+;base64,([A-Za-z0-9+/=]+)', content)
            if m:
                save_image(base64.b64decode(m.group(1)), f"gemini{suffix}.png")
                return
        print(f"  ✗ 未找到图像")
    except Exception as e:
        print(f"  ✗ {e}")


# ═══════════════════════════════════════════
# Engine 2: Flux Pro (BFL 直连)
# ═══════════════════════════════════════════
def test_flux_bfl(prompt, suffix=""):
    key = os.getenv("BFL_API_KEY")
    if not key:
        print("  ⏭️  BFL_API_KEY 未设置")
        return
    print("\n🟣 Flux 2 Pro (BFL Direct)...")
    try:
        resp = requests.post(
            "https://api.bfl.ai/v1/flux-2-pro",
            headers={"x-key": key, "Content-Type": "application/json"},
            json={"prompt": prompt, "width": 1920, "height": 1080},
            timeout=30
        )
        task = resp.json()
        poll_url = task.get("polling_url") or task.get("id")
        if not poll_url:
            print(f"  ✗ 提交失败: {task}")
            return
        if not poll_url.startswith("http"):
            poll_url = f"https://api.bfl.ai/v1/get_result?id={poll_url}"
        # 轮询等待
        for _ in range(60):
            time.sleep(3)
            r = requests.get(poll_url, headers={"x-key": key}, timeout=15).json()
            status = r.get("status", "")
            if status == "Ready":
                img_url = r.get("result", {}).get("sample", "")
                if img_url:
                    save_image(img_url, f"flux_pro{suffix}.png")
                    return
                print(f"  ✗ Ready 但无 sample: {r}")
                return
            elif status in ("Error", "Failed"):
                print(f"  ✗ {r}")
                return
            print(f"  ⏳ {status}...", end="\r")
        print("  ✗ 超时")
    except Exception as e:
        print(f"  ✗ {e}")


# ═══════════════════════════════════════════
# Engine 3: fal.ai (Flux 2 Pro)
# ═══════════════════════════════════════════
def test_fal(prompt, suffix=""):
    key = os.getenv("FAL_KEY")
    if not key:
        print("  ⏭️  FAL_KEY 未设置")
        return
    print("\n🟡 Flux 2 Pro (fal.ai)...")
    try:
        resp = requests.post(
            "https://fal.run/fal-ai/flux-2-pro",
            headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
            json={"prompt": prompt, "image_size": "landscape_16_9"},
            timeout=120
        )
        data = resp.json()
        images = data.get("images", [])
        if images and images[0].get("url"):
            save_image(images[0]["url"], f"fal_flux{suffix}.png")
        else:
            print(f"  ✗ {json.dumps(data)[:200]}")
    except Exception as e:
        print(f"  ✗ {e}")


# ═══════════════════════════════════════════
# Engine 4: 可灵 Kling AI
# ═══════════════════════════════════════════
def test_kling(prompt, suffix=""):
    ak = os.getenv("KLING_ACCESS_KEY")
    sk = os.getenv("KLING_SECRET_KEY")
    if not ak or not sk:
        print("  ⏭️  KLING_ACCESS_KEY / KLING_SECRET_KEY 未设置")
        return
    print("\n🔴 Kling AI (可灵 v3)...")
    try:
        import jwt
        now = int(time.time())
        payload = {
            "iss": ak,
            "exp": now + 1800,
            "nbf": now - 5,
        }
        token = jwt.encode(payload, sk, algorithm="HS256",
                           headers={"alg": "HS256", "typ": "JWT"})

        resp = requests.post(
            "https://api.klingai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "model_name": "kling-v2-1",
                "prompt": prompt,
                "aspect_ratio": "16:9",
                "n": 1
            },
            timeout=30
        )
        data = resp.json()
        task_id = data.get("data", {}).get("task_id")
        if not task_id:
            print(f"  ✗ 提交失败: {data}")
            return
        # 轮询
        for _ in range(60):
            time.sleep(3)
            r = requests.get(
                f"https://api.klingai.com/v1/images/generations/{task_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15
            ).json()
            status = r.get("data", {}).get("task_status", "")
            if status == "succeed":
                images = r.get("data", {}).get("task_result", {}).get("images", [])
                if images:
                    save_image(images[0].get("url", ""), f"kling{suffix}.png")
                    return
                print(f"  ✗ 成功但无图: {r}")
                return
            elif status == "failed":
                print(f"  ✗ {r}")
                return
            print(f"  ⏳ {status}...", end="\r")
        print("  ✗ 超时")
    except ImportError:
        print("  ✗ 需要 pip3 install PyJWT")
    except Exception as e:
        print(f"  ✗ {e}")


# ═══════════════════════════════════════════
# Engine 5: Together AI (Flux 2 Pro)
# ═══════════════════════════════════════════
def test_together(prompt, suffix=""):
    key = os.getenv("TOGETHER_API_KEY")
    if not key:
        print("  ⏭️  TOGETHER_API_KEY 未设置")
        return
    print("\n🟢 Flux 2 Pro (Together AI)...")
    try:
        resp = requests.post(
            "https://api.together.xyz/v1/images/generations",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": "black-forest-labs/FLUX.2-pro",
                "prompt": prompt,
                "width": 1920,
                "height": 1080,
                "steps": 4
            },
            timeout=120
        )
        data = resp.json()
        images = data.get("data", [])
        if images and images[0].get("url"):
            save_image(images[0]["url"], f"together_flux{suffix}.png")
        elif images and images[0].get("b64_json"):
            save_image(images[0]["b64_json"], f"together_flux{suffix}.png")
        else:
            print(f"  ✗ {json.dumps(data)[:200]}")
    except Exception as e:
        print(f"  ✗ {e}")


def main():
    print("=" * 60)
    print("神临山海 AI漫剧 · 引擎对比测试")
    print("场景：Ch1 九色渊 · 麦洛浮出水面")
    print(f"输出：{OUT}")
    print("=" * 60)

    # 测试 1: 标准 prompt
    print("\n━━━ Test A: 标准 Prompt ━━━")
    test_gemini(PROMPT_CH1, "_a")
    test_flux_bfl(PROMPT_CH1, "_a")
    test_fal(PROMPT_CH1, "_a")
    test_kling(PROMPT_CH1, "_a")
    test_together(PROMPT_CH1, "_a")

    # 测试 2: 水墨风格加强 prompt
    print("\n\n━━━ Test B: 水墨风格加强 Prompt ━━━")
    test_gemini(PROMPT_CH1_INKWASH, "_b")
    test_flux_bfl(PROMPT_CH1_INKWASH, "_b")
    test_fal(PROMPT_CH1_INKWASH, "_b")
    test_kling(PROMPT_CH1_INKWASH, "_b")
    test_together(PROMPT_CH1_INKWASH, "_b")

    print("\n\n" + "=" * 60)
    results = sorted(OUT.glob("*.png"))
    print(f"✨ 共生成 {len(results)} 张测试图：")
    for f in results:
        print(f"   {f.name}  ({f.stat().st_size//1024} KB)")
    print(f"\n打开对比：open {OUT}")
    print("=" * 60)


if __name__ == "__main__":
    main()
