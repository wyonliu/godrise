#!/usr/bin/env python3
"""
神临山海 · AI漫画生产线
读取分镜 JSON → 生图 → 配音 → 合成视频（Ken Burns + 字幕）

运行：
  python3 gen_manga.py --chapter 1                      # 全流程
  python3 gen_manga.py --chapter 1 --images-only         # 仅生图
  python3 gen_manga.py --chapter 1 --voice-only          # 仅配音
  python3 gen_manga.py --chapter 1 --video-only          # 仅合成视频
  python3 gen_manga.py --chapter 1 --engine flux         # 用 Flux 引擎
  python3 gen_manga.py --chapter 1 --start 10 --end 20   # 仅面板 10-20

依赖：pip install requests python-dotenv pydub Pillow PyJWT
"""
import argparse, base64, json, math, os, re, subprocess, sys, tempfile, time
from pathlib import Path
from typing import Optional

# ─── .env 加载：本地 + CaptainCast ───────────────────────
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
CAPTAINCAST_ENV = Path("/Users/wyon/root/code-ai/CaptainCast/.env")
LOCAL_ENV = SCRIPT_DIR / ".env"

# CaptainCast .env 先加载（voice keys），本地 .env 覆盖
if CAPTAINCAST_ENV.exists():
    load_dotenv(CAPTAINCAST_ENV, override=False)
if LOCAL_ENV.exists():
    load_dotenv(LOCAL_ENV, override=True)

# ─── API Keys ────────────────────────────────────────────
OR_KEY   = os.getenv("OPENROUTER_API_KEY", "")
BFL_KEY  = os.getenv("BFL_API_KEY", "")
FAL_KEY  = os.getenv("FAL_KEY", "")
KLING_AK = os.getenv("KLING_ACCESS_KEY", "")
KLING_SK = os.getenv("KLING_SECRET_KEY", "")

MM_KEY   = os.getenv("MINIMAX_API_KEY", "")
MM_GROUP = os.getenv("MINIMAX_GROUP_ID", "")
CAP_ID   = os.getenv("CAPTAIN_VOICE_ID", "captain_captaincast")
MEL_ID   = os.getenv("MELODY_VOICE_ID", "melody_captaincast")

CAPTAIN_SPEED_MULT = float(os.getenv("CAPTAIN_SPEED_MULT", "1.05"))
MELODY_SPEED_MULT  = float(os.getenv("MELODY_SPEED_MULT", "1.0"))
MELODY_VOL_DB      = float(os.getenv("MELODY_VOL_DB", "2.28"))
MELODY_API_VOL     = float(os.getenv("MELODY_API_VOL", "1.5"))
BGM_VOL_DB         = float(os.getenv("BGM_VOL_DB", "-22"))
BGM_PATH           = Path(os.getenv("BGM_PATH", str(SCRIPT_DIR.parent / "memory" / "bgm.mp3")))

PROXY = {"https": "http://127.0.0.1:1087", "http": "http://127.0.0.1:1087"}
RATE_LIMIT_DELAY = 2.0  # 秒，API 间隔

# ─── 调色板 ──────────────────────────────────────────────
GOLD  = (200, 169, 110)
DARK  = (5, 5, 14)
WHITE = (252, 248, 240)

# ─── 字体 ────────────────────────────────────────────────
FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
]

# ─── 引擎定价（美元/张，粗估） ───────────────────────────
ENGINE_COST = {
    "gemini": 0.02,
    "flux":   0.05,
    "fal":    0.04,
    "kling":  0.03,
}


# ════════════════════════════════════════════════════════════
# 工具函数
# ════════════════════════════════════════════════════════════

def fnt(size, bold=False):
    from PIL import ImageFont
    for path in FONT_PATHS:
        try:
            idx = 1 if (bold and "PingFang" in path) else 0
            return ImageFont.truetype(path, size, index=idx)
        except Exception:
            continue
    return ImageFont.load_default()


def ffprobe_duration_ms(path):
    """用 ffprobe 获取音频时长（毫秒）"""
    cmd = [
        "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        return int(float(r.stdout.strip()) * 1000)
    return 3000


def load_storyboard(chapter: int) -> dict:
    """加载 ch{NN}_storyboard.json"""
    sb_path = SCRIPT_DIR / f"ch{chapter:02d}_storyboard.json"
    if not sb_path.exists():
        print(f"  未找到分镜文件: {sb_path}")
        sys.exit(1)
    data = json.loads(sb_path.read_text(encoding="utf-8"))
    return data


# ════════════════════════════════════════════════════════════
# 图像生成引擎
# ════════════════════════════════════════════════════════════

import requests


def _retry(fn, retries=3):
    """通用重试包装，指数退避"""
    for attempt in range(retries):
        try:
            return fn()
        except (requests.exceptions.SSLError,
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout) as e:
            if attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print(f"      连接错误，{wait}秒后重试 ({attempt+1}/{retries})...")
                time.sleep(wait)
            else:
                print(f"      连接失败: {e}")
                return None
        except Exception as e:
            print(f"      异常: {e}")
            return None


def gen_image_gemini(prompt: str) -> Optional[bytes]:
    """Gemini via OpenRouter"""
    if not OR_KEY:
        print("      OPENROUTER_API_KEY 未设置")
        return None

    def _call():
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OR_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://wyonliu.github.io/CaptainCast/",
                "X-Title": "GodRise-Manga"
            },
            json={
                "model": "google/gemini-3.1-flash-image-preview",
                "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
            },
            proxies=PROXY,
            timeout=120
        )
        data = resp.json()
        if "error" in data:
            print(f"      API错误: {data['error'].get('message', data['error'])}")
            return None

        msg = data["choices"][0]["message"]
        # 从 images 或 content 提取 base64
        for images_field in [msg.get("images", []),
                             msg.get("content") if isinstance(msg.get("content"), list) else []]:
            if not images_field:
                continue
            for part in images_field:
                if not isinstance(part, dict):
                    continue
                url = part.get("image_url", {}).get("url", "")
                if url.startswith("data:"):
                    return base64.b64decode(url.split(",")[1])
                elif url.startswith("http"):
                    return requests.get(url, timeout=30).content

        content = msg.get("content", "")
        if isinstance(content, str):
            m = re.search(r'data:image/\w+;base64,([A-Za-z0-9+/=]+)', content)
            if m:
                return base64.b64decode(m.group(1))
        print(f"      未找到图像，响应: {json.dumps(data)[:200]}")
        return None

    return _retry(_call)


def gen_image_flux(prompt: str) -> Optional[bytes]:
    """Flux via BFL API (async polling)"""
    if not BFL_KEY:
        print("      BFL_API_KEY 未设置")
        return None

    def _call():
        # 提交任务
        resp = requests.post(
            "https://api.bfl.ai/v1/flux-2-pro",
            headers={"x-key": BFL_KEY, "Content-Type": "application/json"},
            json={"prompt": prompt, "width": 1920, "height": 1080},
            timeout=30
        )
        resp.raise_for_status()
        task = resp.json()
        polling_url = task.get("polling_url") or task.get("id")
        if not polling_url:
            print(f"      未返回 polling_url: {task}")
            return None

        # 如果返回的是 ID 而非完整 URL
        if not polling_url.startswith("http"):
            polling_url = f"https://api.bfl.ai/v1/get_result?id={polling_url}"

        # 轮询
        for _ in range(60):  # 最多等 5 分钟
            time.sleep(5)
            pr = requests.get(polling_url, headers={"x-key": BFL_KEY}, timeout=30)
            pr.raise_for_status()
            result = pr.json()
            status = result.get("status", "")
            if status == "Ready":
                sample_url = result.get("result", {}).get("sample") or result.get("sample")
                if sample_url:
                    img_resp = requests.get(sample_url, timeout=60)
                    img_resp.raise_for_status()
                    return img_resp.content
                print(f"      Ready 但无 sample URL: {result}")
                return None
            elif status in ("Failed", "Error"):
                print(f"      任务失败: {result}")
                return None
            # Pending / Processing → 继续轮询
        print("      轮询超时")
        return None

    return _retry(_call)


def gen_image_fal(prompt: str) -> Optional[bytes]:
    """fal.ai Flux (synchronous)"""
    if not FAL_KEY:
        print("      FAL_KEY 未设置")
        return None

    def _call():
        resp = requests.post(
            "https://fal.run/fal-ai/flux-2-pro",
            headers={
                "Authorization": f"Key {FAL_KEY}",
                "Content-Type": "application/json"
            },
            json={"prompt": prompt, "image_size": "landscape_16_9"},
            timeout=180
        )
        resp.raise_for_status()
        data = resp.json()
        images = data.get("images", [])
        if images and images[0].get("url"):
            img_resp = requests.get(images[0]["url"], timeout=60)
            img_resp.raise_for_status()
            return img_resp.content
        print(f"      未返回图像: {json.dumps(data)[:200]}")
        return None

    return _retry(_call)


def gen_image_kling(prompt: str) -> Optional[bytes]:
    """Kling API (JWT auth, async polling)"""
    if not KLING_AK or not KLING_SK:
        print("      KLING_ACCESS_KEY / KLING_SECRET_KEY 未设置")
        return None

    import jwt as pyjwt

    def _call():
        now = int(time.time())
        token = pyjwt.encode(
            {"iss": KLING_AK, "exp": now + 1800, "nbf": now - 5},
            KLING_SK,
            algorithm="HS256"
        )

        # 提交任务
        resp = requests.post(
            "https://api.klingai.com/v1/images/generations",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json={
                "model_name": "kling-v2-1",
                "prompt": prompt,
                "aspect_ratio": "16:9",
                "n": 1
            },
            timeout=30
        )
        resp.raise_for_status()
        task_data = resp.json()
        task_id = task_data.get("data", {}).get("task_id")
        if not task_id:
            print(f"      未返回 task_id: {task_data}")
            return None

        # 轮询
        for _ in range(60):
            time.sleep(5)
            pr = requests.get(
                f"https://api.klingai.com/v1/images/generations/{task_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30
            )
            pr.raise_for_status()
            result = pr.json()
            status = result.get("data", {}).get("task_status", "")
            if status == "succeed":
                images = result.get("data", {}).get("task_result", {}).get("images", [])
                if images and images[0].get("url"):
                    img_resp = requests.get(images[0]["url"], timeout=60)
                    img_resp.raise_for_status()
                    return img_resp.content
                print(f"      succeed 但无图片: {result}")
                return None
            elif status == "failed":
                print(f"      任务失败: {result}")
                return None
        print("      轮询超时")
        return None

    return _retry(_call)


ENGINES = {
    "gemini": gen_image_gemini,
    "flux":   gen_image_flux,
    "fal":    gen_image_fal,
    "kling":  gen_image_kling,
}


# ════════════════════════════════════════════════════════════
# Phase 1: 图像生成
# ════════════════════════════════════════════════════════════

def phase_images(panels, engine_name, out_dir, start, end):
    """为每个面板生成图像"""
    engine_fn = ENGINES.get(engine_name)
    if not engine_fn:
        print(f"  未知引擎: {engine_name}，可选: {', '.join(ENGINES.keys())}")
        sys.exit(1)

    panels_dir = out_dir / "panels"
    panels_dir.mkdir(parents=True, exist_ok=True)

    total = len(panels)
    generated = 0
    skipped = 0

    print(f"\n{'='*58}")
    print(f"Phase 1: 图像生成  引擎={engine_name}  面板={start}-{end}")
    print(f"{'='*58}\n")

    for i, panel in enumerate(panels):
        panel_num = i + 1
        if panel_num < start or panel_num > end:
            continue

        out_path = panels_dir / f"panel_{panel_num:03d}.png"

        # 跳过已存在的图
        if out_path.exists() and out_path.stat().st_size > 10240:
            skipped += 1
            kb = out_path.stat().st_size // 1024
            print(f"  [Panel {panel_num:03d}/{total}] 已存在，跳过 ({kb} KB)")
            continue

        prompt = panel.get("prompt", panel.get("image_prompt", ""))
        if not prompt:
            print(f"  [Panel {panel_num:03d}/{total}] 无 prompt，跳过")
            continue

        # 强制 16:9
        if "16:9" not in prompt.lower() and "1920" not in prompt:
            prompt += " Cinematic widescreen 16:9 landscape. No text overlay."

        print(f"  [Panel {panel_num:03d}/{total}] 生成中...")
        print(f"    prompt: {prompt[:80]}...")

        img_data = engine_fn(prompt)
        if img_data:
            out_path.write_bytes(img_data)
            kb = len(img_data) // 1024
            print(f"    {out_path.name}  ({kb} KB)")
            generated += 1
        else:
            print(f"    跳过（生成失败）")

        time.sleep(RATE_LIMIT_DELAY)

    print(f"\n  图像完成: 生成 {generated} / 跳过 {skipped} / 总计 {total}")
    return generated


# ════════════════════════════════════════════════════════════
# Phase 2: 语音合成
# ════════════════════════════════════════════════════════════

def tts_minimax(text, voice_id, speed, out_path, vol=1.0, retries=3):
    """MiniMax Speech-01-HD TTS"""
    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(
                f"https://api.minimax.chat/v1/t2a_v2?GroupId={MM_GROUP}",
                headers={
                    "Authorization": f"Bearer {MM_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "speech-01-hd",
                    "text": text,
                    "stream": False,
                    "voice_setting": {
                        "voice_id": voice_id,
                        "speed": speed,
                        "vol": vol,
                        "pitch": 0
                    },
                    "audio_setting": {"format": "mp3", "sample_rate": 44100}
                },
                timeout=120
            )
            data = json.loads(resp.content.decode("utf-8"))
            if data.get("base_resp", {}).get("status_code") != 0:
                print(f"      TTS错误: {data.get('base_resp',{}).get('status_msg', data)}")
                return False
            audio_hex = data.get("data", {}).get("audio", "")
            if not audio_hex:
                print(f"      未返回音频")
                return False
            Path(out_path).write_bytes(bytes.fromhex(audio_hex))
            return True
        except Exception as e:
            if attempt < retries:
                print(f"      第{attempt}次失败({type(e).__name__})，3秒后重试...")
                time.sleep(3)
            else:
                print(f"      连续{retries}次失败: {e}")
                return False
    return False


# 剔除舞台提示
STAGE_DIR_RE = re.compile(r'[（(][^）)]{1,10}[）)]')

# 角色→voice_id 映射
SPEAKER_MAP = {
    "麦洛": ("melody", MEL_ID),
    "船长": ("captain", CAP_ID),
    "旁白": ("captain", CAP_ID),
}


def phase_voice(panels, out_dir, start, end):
    """为每个面板的对白生成语音"""
    if not MM_KEY:
        print("  MINIMAX_API_KEY 未设置，跳过语音生成")
        return 0

    audio_dir = out_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    total = len(panels)
    generated = 0
    skipped = 0

    print(f"\n{'='*58}")
    print(f"Phase 2: 语音合成  MiniMax Speech-01-HD")
    print(f"{'='*58}\n")

    for i, panel in enumerate(panels):
        panel_num = i + 1
        if panel_num < start or panel_num > end:
            continue

        # 收集本面板所有语音片段：对白 + 旁白
        segments = []
        # 对白列表 [{"speaker": "麦洛", "text": "...", "speed": 1.0}, ...]
        for d in (panel.get("dialogue") or []):
            if isinstance(d, dict) and d.get("text"):
                segments.append((d.get("speaker", "旁白"), d["text"], d.get("speed", 1.0)))
        # 旁白（字符串）
        narration = panel.get("narration", "")
        if narration:
            segments.append(("旁白", narration, 1.0))

        if not segments:
            continue

        for seg_idx, (speaker, text, speed) in enumerate(segments):
            suffix = f"_{seg_idx}" if len(segments) > 1 else ""
            out_path = audio_dir / f"panel_{panel_num:03d}{suffix}.mp3"

            # 跳过已存在
            if out_path.exists() and out_path.stat().st_size > 1024:
                skipped += 1
                kb = out_path.stat().st_size // 1024
                print(f"  [Panel {panel_num:03d}{suffix}/{total}] 已存在，跳过 ({kb} KB)")
                continue

            # 清理舞台提示
            clean_text = STAGE_DIR_RE.sub("", text).strip()
            if not clean_text:
                continue

            role_key, voice_id = SPEAKER_MAP.get(speaker, ("captain", CAP_ID))
            mult = CAPTAIN_SPEED_MULT if role_key == "captain" else MELODY_SPEED_MULT
            actual_speed = round(min(2.0, speed * mult), 3)
            api_vol = MELODY_API_VOL if role_key == "melody" else 1.0

            print(f"  [Panel {panel_num:03d}{suffix}/{total}] {speaker} x{actual_speed}  {clean_text[:40]}...")

            if tts_minimax(clean_text, voice_id, actual_speed, out_path, vol=api_vol):
                kb = out_path.stat().st_size // 1024
                print(f"    {out_path.name}  ({kb} KB)")
                generated += 1
            else:
                print(f"    跳过（TTS失败）")

            time.sleep(0.5)

    print(f"\n  语音完成: 生成 {generated} / 跳过 {skipped} / 总计 {total}")
    return generated


# ════════════════════════════════════════════════════════════
# Phase 3: 视频合成
# ════════════════════════════════════════════════════════════

def make_subtitle_image(text, W, H, font_size=42):
    """生成字幕 PNG（透明背景 + 半透明黑底 + 白字）"""
    from PIL import Image, ImageDraw
    fn = fnt(font_size, bold=True)
    dummy = Image.new("RGBA", (1, 1))
    dd = ImageDraw.Draw(dummy)

    max_text_w = int(W * 0.85)
    words = list(text)
    lines = []
    buf = []
    for ch in words:
        buf.append(ch)
        if dd.textlength("".join(buf), font=fn) >= max_text_w:
            lines.append("".join(buf))
            buf = []
    if buf:
        lines.append("".join(buf))

    line_h = font_size + 10
    total_h = len(lines) * line_h + 30
    sub_y = H - total_h - 60

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, sub_y, W, sub_y + total_h], fill=(5, 5, 14, 180))

    y = sub_y + 15
    for line in lines:
        lw = int(draw.textlength(line, font=fn))
        x = (W - lw) // 2
        draw.text((x + 2, y + 2), line, font=fn, fill=(0, 0, 0, 200))
        draw.text((x, y), line, font=fn, fill=WHITE)
        y += line_h

    return img


def make_kenburns_clip(image_path, duration_s, output_path, W, H, effect="zoom_in"):
    """Ken Burns 效果视频片段"""
    fps = 30
    total_frames = max(1, int(duration_s * fps))

    effects = {
        "zoom_in":   f"z='min(1.15,1+0.15*on/{total_frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
        "slow_zoom": f"z='min(1.08,1+0.08*on/{total_frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
        "zoom_out":  f"z='max(1.0,1.15-0.15*on/{total_frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
        "pan_left":  f"z=1.12:x='iw*0.12*(1-on/{total_frames})':y='ih/2-(ih/zoom/2)'",
        "pan_right": f"z=1.12:x='iw*0.12*on/{total_frames}':y='ih/2-(ih/zoom/2)'",
        "pan_up":    f"z=1.12:x='iw/2-(iw/zoom/2)':y='ih*0.12*(1-on/{total_frames})'",
        "pan_down":  f"z=1.12:x='iw/2-(iw/zoom/2)':y='ih*0.12*on/{total_frames}'",
        "static":    f"z=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    }
    zp = effects.get(effect, effects["zoom_in"])

    vf = (
        f"scale={W*2}:{H*2}:force_original_aspect_ratio=decrease,"
        f"pad={W*2}:{H*2}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"zoompan={zp}:d={total_frames}:s={W}x{H}:fps={fps},"
        f"format=yuv420p"
    )

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(image_path),
        "-vf", vf,
        "-t", f"{duration_s:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-an",
        str(output_path)
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"      Ken Burns 失败: {Path(image_path).name}")
        print(f"      {r.stderr[-300:]}")
        return False
    return True


def make_watermark(W, H, label, tmp_dir):
    """右上角水印"""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    fn = fnt(20, bold=False)
    text = f"神临山海 {label}"
    tw = int(draw.textlength(text, font=fn))
    x = W - tw - 30
    y = 20
    draw.rectangle([x - 10, y - 5, x + tw + 10, y + 25], fill=(5, 5, 14, 120))
    draw.text((x, y), text, font=fn, fill=(*GOLD, 180))
    path = Path(tmp_dir) / "watermark.png"
    img.save(str(path), "PNG")
    return path


def phase_video(panels, out_dir, chapter):
    """合成最终视频"""
    from PIL import Image

    panels_dir = out_dir / "panels"
    audio_dir = out_dir / "audio"
    W, H = 1920, 1080

    print(f"\n{'='*58}")
    print(f"Phase 3: 视频合成  Ken Burns + 字幕")
    print(f"{'='*58}\n")

    # 检查面板图像
    available = []
    for i, panel in enumerate(panels):
        panel_num = i + 1
        img_path = panels_dir / f"panel_{panel_num:03d}.png"
        audio_path = audio_dir / f"panel_{panel_num:03d}.mp3"
        if not img_path.exists():
            print(f"  [Panel {panel_num:03d}] 无图像，跳过")
            continue
        available.append({
            "panel_num": panel_num,
            "panel": panel,
            "img_path": img_path,
            "audio_path": audio_path if audio_path.exists() else None,
        })

    if not available:
        print("  无可用面板")
        return False

    print(f"  可用面板: {len(available)}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        clips = []

        for idx, item in enumerate(available):
            pnum = item["panel_num"]
            panel = item["panel"]
            img_path = item["img_path"]
            audio_path = item["audio_path"]

            # 确定时长：有音频用音频时长，否则用 storyboard 的 duration 或默认 4s
            if audio_path:
                dur_s = ffprobe_duration_ms(audio_path) / 1000.0
                # 至少留 0.5s 呼吸
                dur_s = max(dur_s + 0.3, panel.get("duration_sec", panel.get("duration", 4.0)))
            else:
                dur_s = panel.get("duration_sec", panel.get("duration", 4.0))

            effect = panel.get("camera", "zoom_in")
            # 从 dialogue 列表和 narration 合成字幕文本
            sub_parts = []
            for d in (panel.get("dialogue") or []):
                if isinstance(d, dict) and d.get("text"):
                    sub_parts.append(d["text"])
            narration = panel.get("narration", "")
            if narration:
                sub_parts.append(narration)
            subtitle_text = "　".join(sub_parts)

            print(f"  [Panel {pnum:03d}] {dur_s:.1f}s {effect} {subtitle_text[:30]}...")

            # 1. Ken Burns 视频片段
            clip_path = tmp / f"clip_{idx:03d}.mp4"
            if not make_kenburns_clip(img_path, dur_s, clip_path, W, H, effect):
                make_kenburns_clip(img_path, dur_s, clip_path, W, H, "static")

            # 2. 叠加字幕
            if subtitle_text:
                sub_img = make_subtitle_image(subtitle_text, W, H, font_size=42)
                sub_path = tmp / f"sub_{idx:03d}.png"
                sub_img.save(str(sub_path), "PNG")

                clip_with_sub = tmp / f"clip_sub_{idx:03d}.mp4"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(clip_path),
                    "-i", str(sub_path),
                    "-filter_complex", "[0:v][1:v]overlay=0:0[v]",
                    "-map", "[v]",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-an",
                    str(clip_with_sub)
                ]
                r = subprocess.run(cmd, capture_output=True, text=True)
                if r.returncode == 0:
                    clip_path = clip_with_sub

            clips.append(clip_path)

        if not clips:
            print("  无视频片段生成")
            return False

        # 3. 拼接所有视频片段
        print(f"\n  拼接 {len(clips)} 个片段...")
        concat_file = tmp / "concat.txt"
        with open(concat_file, "w") as f:
            for c in clips:
                f.write(f"file '{c.resolve()}'\n")

        video_only = tmp / "video_only.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(concat_file),
            "-c:v", "libx264", "-preset", "slow", "-crf", "18",
            "-pix_fmt", "yuv420p", "-an",
            str(video_only)
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  拼接失败: {r.stderr[-500:]}")
            return False

        # 4. 合并音频：按顺序拼接面板音频段
        audio_parts = []
        for item in available:
            if item["audio_path"]:
                audio_parts.append(item["audio_path"])

        if audio_parts:
            print(f"  合并 {len(audio_parts)} 段音频...")
            try:
                from pydub import AudioSegment
                silence = AudioSegment.silent(duration=300)  # 面板间 0.3s 间隔
                combined_audio = AudioSegment.empty()
                for ap in audio_parts:
                    seg = AudioSegment.from_mp3(str(ap))
                    # 麦洛音量补偿
                    # 麦洛音量补偿：检查对白列表中是否有麦洛
                    panel_num = int(ap.stem.split("_")[1])
                    panel_idx = panel_num - 1
                    if panel_idx < len(panels):
                        has_melody = any(
                            d.get("speaker") == "麦洛"
                            for d in (panels[panel_idx].get("dialogue") or [])
                            if isinstance(d, dict)
                        )
                        if has_melody and MELODY_VOL_DB != 0:
                            seg = seg + MELODY_VOL_DB
                    combined_audio += seg + silence

                # BGM 混入
                if BGM_PATH.exists():
                    bgm_raw = AudioSegment.from_mp3(str(BGM_PATH)) + BGM_VOL_DB
                    loops = len(combined_audio) // len(bgm_raw) + 2
                    bgm_loop = (bgm_raw * loops)[:len(combined_audio)]
                    bgm_loop = bgm_loop.fade_out(5000)
                    combined_audio = combined_audio.overlay(bgm_loop)
                    print(f"  BGM 混入 ({BGM_VOL_DB}dB)")

                merged_audio = tmp / "audio_merged.mp3"
                combined_audio.export(str(merged_audio), format="mp3", bitrate="128k")
                audio_source = merged_audio
            except ImportError:
                print("  pydub 未安装，用 ffmpeg concat 合并音频...")
                audio_concat_file = tmp / "audio_concat.txt"
                with open(audio_concat_file, "w") as f:
                    for ap in audio_parts:
                        f.write(f"file '{ap.resolve()}'\n")
                merged_audio = tmp / "audio_merged.mp3"
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(audio_concat_file),
                    "-c:a", "libmp3lame", "-b:a", "128k",
                    str(merged_audio)
                ]
                subprocess.run(cmd, capture_output=True, text=True)
                audio_source = merged_audio
        else:
            audio_source = None

        # 5. 水印
        wm_path = make_watermark(W, H, f"Ch.{chapter:02d}", tmp)

        # 6. 最终合成
        output_path = out_dir / f"ch{chapter:02d}_manga.mp4"
        print(f"  最终合成 → {output_path.name}...")

        if audio_source and audio_source.exists():
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_only),
                "-i", str(audio_source),
                "-i", str(wm_path),
                "-filter_complex", "[0:v][2:v]overlay=0:0[v]",
                "-map", "[v]", "-map", "1:a",
                "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                str(output_path)
            ]
        else:
            # 无音频，纯视频 + 水印
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_only),
                "-i", str(wm_path),
                "-filter_complex", "[0:v][1:v]overlay=0:0[v]",
                "-map", "[v]",
                "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                str(output_path)
            ]

        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  合成失败: {r.stderr[-500:]}")
            return False

        mb = output_path.stat().st_size / 1024 / 1024
        print(f"  {output_path.name}  ({mb:.1f} MB)")
        return True


# ════════════════════════════════════════════════════════════
# 主入口
# ════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="神临山海 · AI漫画生产线")
    parser.add_argument("--chapter", "-c", type=int, required=True, help="章节号 (1, 2, ...)")
    parser.add_argument("--engine", "-e", default="gemini",
                        choices=list(ENGINES.keys()),
                        help="生图引擎 (default: gemini)")
    parser.add_argument("--start", type=int, default=1, help="起始面板号 (默认 1)")
    parser.add_argument("--end", type=int, default=9999, help="结束面板号 (默认全部)")
    parser.add_argument("--images-only", action="store_true", help="仅生成图像")
    parser.add_argument("--voice-only", action="store_true", help="仅生成语音")
    parser.add_argument("--video-only", action="store_true", help="仅合成视频")
    args = parser.parse_args()

    chapter = args.chapter
    engine = args.engine
    start = args.start

    # 加载分镜
    storyboard = load_storyboard(chapter)
    panels = storyboard.get("panels", [])
    title = storyboard.get("title", f"第{chapter}章")
    total = len(panels)
    end = min(args.end, total)

    # 输出目录
    out_dir = SCRIPT_DIR / "output" / f"ch{chapter:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "panels").mkdir(exist_ok=True)
    (out_dir / "audio").mkdir(exist_ok=True)

    # 判断运行模式
    run_all = not (args.images_only or args.voice_only or args.video_only)
    run_images = run_all or args.images_only
    run_voice = run_all or args.voice_only
    run_video = run_all or args.video_only

    print("=" * 58)
    print(f"神临山海 · AI漫画  Ch.{chapter:02d}「{title}」")
    print(f"面板: {total}  范围: {start}-{end}  引擎: {engine}")
    print(f"输出: {out_dir}")
    print("=" * 58)

    img_count = 0
    voice_count = 0

    # Phase 1: 图像
    if run_images:
        img_count = phase_images(panels, engine, out_dir, start, end)

    # Phase 2: 语音
    if run_voice:
        voice_count = phase_voice(panels, out_dir, start, end)

    # Phase 3: 视频
    if run_video:
        phase_video(panels, out_dir, chapter)

    # ─── 成本估算 ─────────────────────────────────────────
    cost_per_img = ENGINE_COST.get(engine, 0.03)
    # 语音成本：MiniMax ¥2/万字符 ≈ $0.0003/字符
    total_chars = sum(
        sum(len(d.get("text", "")) for d in (p.get("dialogue") or []) if isinstance(d, dict))
        + len(p.get("narration", ""))
        for p in panels[start-1:end]
    )
    voice_cost_usd = total_chars * 0.0003

    print(f"\n{'='*58}")
    print(f"成本估算:")
    print(f"  图像: {img_count} x ${cost_per_img:.2f} = ${img_count * cost_per_img:.2f}")
    print(f"  语音: {total_chars} 字 ≈ ${voice_cost_usd:.2f}")
    print(f"  合计: ${img_count * cost_per_img + voice_cost_usd:.2f}")
    print(f"{'='*58}")


if __name__ == "__main__":
    main()
