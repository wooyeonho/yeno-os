#!/usr/bin/env python3
"""Rasterize bounded original text cards; never fetch, execute content or encode media.

Adapted from BLACKHOLE's render-video-draft.py. Node owns process deadlines,
FFmpeg, cancellation, output verification and atomic result publication.
Debian packages: python3-pil, python3-fonttools, fonts-nanum.
Nanum Gothic: https://github.com/google/fonts/blob/main/ofl/nanumgothic/OFL.txt
"""
import hashlib
import json
import math
from pathlib import Path
import resource
import sys

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

WIDTH, HEIGHT = 720, 1280


def wrap(draw, content, font, width):
    lines = []
    for paragraph in content.split('\n'):
        current = ''
        for char in paragraph:
            if current and draw.textlength(current + char, font=font) > width:
                lines.append(current.rstrip())
                current = char.lstrip()
            else:
                current += char
        lines.append(current.rstrip())
    return lines


def text(draw, content, box, font_path, size, color):
    x, y, width, height = box
    while size >= 20:
        font = ImageFont.truetype(str(font_path), size)
        lines = wrap(draw, content, font, width)
        advance = math.ceil(size * 1.4)
        if len(lines) * advance <= height:
            for index, line in enumerate(lines):
                draw.text((x, y + index * advance), line, font=font, fill=color)
            return
        size -= 2
    raise ValueError('VIDEO_TEXT_OVERFLOW')


def render(manifest, output, font_path):
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 * 1024, 4 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    raw = manifest.read_bytes()
    if len(raw) > 16384:
        raise ValueError('VIDEO_INPUT_LIMIT')
    data = json.loads(raw)
    if set(data) != {'title', 'scenes'} or not isinstance(data['scenes'], list) or not 1 <= len(data['scenes']) <= 6:
        raise ValueError('VIDEO_INPUT_INVALID')
    required = data['title'] + ''.join(scene['heading'] + scene['body'] for scene in data['scenes'])
    with TTFont(font_path) as font:
        cmap = font.getBestCmap()
        if any(ord(char) not in cmap for char in required if not char.isspace()):
            raise ValueError('VIDEO_FONT_MISSING_GLYPH')
        family = font['name'].getDebugName(1) or 'unknown'
        if 'nanum' not in family.lower():
            raise ValueError('VIDEO_FONT_FAMILY_UNSUPPORTED')
    for index, scene in enumerate(data['scenes']):
        frame = Image.new('RGB', (WIDTH, HEIGHT), '#071713')
        draw = ImageDraw.Draw(frame)
        draw.rounded_rectangle((32, 235, 688, 1044), radius=36, fill='#102c23', outline='#2c5645', width=2)
        draw.ellipse((550, 290, 646, 386), outline='#448a6c', width=2)
        draw.ellipse((573, 313, 623, 363), fill='#73e7b5')
        text(draw, 'BLACKHOLE / CONTENT LAB', (52, 80, 616, 65), font_path, 25, '#79e6b8')
        text(draw, data['title'], (52, 148, 616, 80), font_path, 26, '#c4d8ce')
        text(draw, f'{index + 1:02d} / {len(data["scenes"]):02d}', (64, 300, 390, 60), font_path, 30, '#79e6b8')
        text(draw, scene['heading'], (64, 435, 584, 275), font_path, 54, '#f1faf5')
        draw.rectangle((64, 755, 156, 761), fill='#73e7b5')
        text(draw, scene['body'], (64, 802, 584, 210), font_path, 32, '#c4d8ce')
        text(draw, 'ORIGINAL TEXT CARDS / NO AUDIO', (52, 1100, 616, 70), font_path, 22, '#9fb8ab')
        draw.rounded_rectangle((52, 1200, 668, 1208), radius=4, fill='#284d3d')
        draw.rectangle((52, 1200, 52 + round(616 * (index + 1) / len(data['scenes'])), 1208), fill='#73e7b5')
        with (output / f'scene-{index}.png').open('xb') as target:
            frame.save(target, format='PNG')
        frame.close()
    return {'fontFamily': family, 'fontSha256': hashlib.sha256(font_path.read_bytes()).hexdigest()}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('VIDEO_ARGUMENTS_INVALID')
        print(json.dumps(render(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))))
    except Exception as error:
        marker = str(error) if str(error).startswith('VIDEO_') else type(error).__name__
        print(marker, file=sys.stderr)
        sys.exit(1)
