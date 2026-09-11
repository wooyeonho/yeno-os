#!/usr/bin/env python3
"""Render reviewed scene cards to an original silent MP4. No fetch/model/publish.

Requires Pillow, fonttools, ffmpeg and ffprobe. Use a trusted local font.
Output must be a new directory; completion is recorded only after full decoding.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

WIDTH, HEIGHT, FPS = 720, 1280, 24


def validate(data):
    if not isinstance(data, dict) or set(data) != {'title', 'sourceUrl', 'rights', 'scenes'}:
        raise ValueError('Expected title, sourceUrl, rights and scenes')
    if data['rights'] != 'original-text-and-graphics':
        raise ValueError('Only original text/graphics are supported by this prototype')
    if not isinstance(data['sourceUrl'], str) or len(data['sourceUrl']) > 2048:
        raise ValueError('Source URL must be a string of at most 2048 characters')
    url = urlsplit(data['sourceUrl'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Use a public HTTPS provenance URL without credentials, query or fragment')
    if not isinstance(data['title'], str) or not 1 <= len(data['title']) <= 60:
        raise ValueError('Title must contain 1–60 characters')
    scenes = data['scenes']
    if not isinstance(scenes, list) or not 2 <= len(scenes) <= 10:
        raise ValueError('Use 2–10 scenes')
    for s in scenes:
        if not isinstance(s, dict) or set(s) != {'heading', 'body', 'seconds'}:
            raise ValueError('Expected heading, body and seconds for each scene')
        if any(not isinstance(s[k], str) or not 1 <= len(s[k]) <= n for k, n in [('heading', 70), ('body', 180)]):
            raise ValueError('Scene text is missing or too long')
        if type(s['seconds']) is not int or not 2 <= s['seconds'] <= 8:
            raise ValueError('Scene duration must be an integer from 2 to 8')
    if sum(s['seconds'] for s in scenes) > 60:
        raise ValueError('Maximum duration is 60 seconds')
    text = data['title'] + ''.join(s['heading'] + s['body'] for s in scenes)
    if any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise ValueError('Control characters are not supported')
    return data


def wrap(draw, text, font, width):
    lines = []
    for paragraph in text.splitlines():
        current = ''
        for char in paragraph:
            if current and draw.textlength(current + char, font=font) > width:
                lines.append(current.rstrip())
                current = char.lstrip()
            else:
                current += char
        lines.append(current.rstrip())
    return lines


def draw_text(draw, text, box, font_path, size, color):
    x, y, w, h = box
    while size >= 20:
        font = ImageFont.truetype(str(font_path), size)
        lines = wrap(draw, text, font, w)
        advance = math.ceil(size * 1.4)
        if len(lines) * advance <= h:
            for i, line in enumerate(lines):
                draw.text((x, y + i * advance), line, font=font, fill=color)
            return
        size -= 2
    raise ValueError('Text cannot fit safely within the scene')


def run(args, timeout):
    # Pass text through PNGs/JSON, never through shell or FFmpeg filter expressions.
    clean_env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TMP', 'TEMP') if k in os.environ}
    result = subprocess.run(args, check=True, capture_output=True, timeout=timeout, env=clean_env)
    return result.stdout


def render(manifest_path, output, font_path):
    raw = manifest_path.read_bytes()
    if len(raw) > 32768:
        raise ValueError('Scene manifest exceeds 32 KiB')
    data = validate(json.loads(raw))
    font_path = font_path.resolve(strict=True)
    with TTFont(font_path) as ft:
        cmap = ft.getBestCmap()
        required = data['title'] + ''.join(s['heading'] + s['body'] for s in data['scenes'])
        if any(ord(c) not in cmap for c in required if not c.isspace()):
            raise ValueError('Font lacks a required glyph')
    # Exclusive creation prevents overwriting previous deliverables or input files.
    output.mkdir(parents=True, exist_ok=False)
    try:
        with tempfile.TemporaryDirectory(prefix='frames-', dir=output) as temp:
            work = Path(temp)
            parts = []
            for index, scene in enumerate(data['scenes']):
                frame = Image.new('RGB', (WIDTH, HEIGHT), '#081610')
                draw = ImageDraw.Draw(frame)
                draw.rounded_rectangle((32, 210, 688, 1040), radius=36, fill='#102820', outline='#28483c', width=2)
                draw.ellipse((545, 275, 645, 375), outline='#315a49', width=2)
                draw.ellipse((565, 295, 625, 355), fill='#64d3a6')
                draw_text(draw, 'BLACKHOLE / CONTENT LAB', (52, 82, 620, 70), font_path, 25, '#77dfb5')
                draw_text(draw, data['title'], (52, 145, 620, 60), font_path, 23, '#b1c8bc')
                draw_text(draw, f'{index+1:02d} / {len(data["scenes"]):02d}', (64, 280, 360, 60), font_path, 30, '#77dfb5')
                draw_text(draw, scene['heading'], (64, 425, 584, 280), font_path, 55, '#eff8f3')
                draw.rectangle((64, 750, 154, 756), fill='#64d3a6')
                draw_text(draw, scene['body'], (64, 800, 584, 190), font_path, 31, '#b9cfc2')
                draw_text(draw, 'DRAFT / ORIGINAL GRAPHICS / NO AUDIO', (52, 1100, 620, 80), font_path, 20, '#90aa9c')
                draw.rounded_rectangle((52, 1200, 668, 1206), radius=3, fill='#254335')
                draw.rectangle((52, 1200, 52 + round(616*(index+1)/len(data['scenes'])), 1206), fill='#64d3a6')
                png, part = work / f'scene-{index}.png', work / f'scene-{index}.mp4'
                frame.save(png)
                if index == 0:
                    frame.save(output / 'preview.png')
                run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-loop', '1', '-framerate', str(FPS), '-i', str(png), '-t', str(scene['seconds']), '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', str(part)], 90)
                parts.append(part)
            (work / 'concat.txt').write_text(''.join(f"file '{p.name}'\n" for p in parts))
            target = output / 'video.mp4'
            run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-f', 'concat', '-safe', '1', '-i', str(work/'concat.txt'), '-c', 'copy', '-movflags', '+faststart', str(target)], 30)
            probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(target)], 15))
            streams = probe['streams']
            duration = sum(s['seconds'] for s in data['scenes'])
            if len(streams) != 1 or streams[0]['codec_name'] != 'h264' or (streams[0]['width'], streams[0]['height']) != (WIDTH, HEIGHT) or abs(float(probe['format']['duration']) - duration) > .1:
                raise ValueError('Output codec/dimensions/duration verification failed')
            run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(target), '-f', 'null', '-'], 60)
            receipt = {'status':'local-render-verified', 'sha256':hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes':target.stat().st_size, 'width':WIDTH, 'height':HEIGHT, 'seconds':duration, 'fps':FPS, 'sourceUrl':data['sourceUrl'], 'sourceFetchedByRenderer':False, 'inputSha256':hashlib.sha256(raw).hexdigest(), 'fontSha256':hashlib.sha256(font_path.read_bytes()).hexdigest(), 'published':False, 'providerCalls':0, 'audio':False, 'runtimeIntegrated':False, 'rights':data['rights']}
            (output/'scenes.json').write_bytes(raw)
            (output/'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
            return receipt
    except Exception:
        (output/'FAILED.txt').write_text('Render incomplete. No success receipt; inspect and retry in a new directory.\n')
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--font', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(render(args.manifest, args.output, args.font), ensure_ascii=False))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Render failed: {type(error).__name__}\n')
