"""Publish finite clock clips and rotate one PR comment for a bounded test."""
import argparse
import io
import json
import subprocess
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageDraw, ImageFont

REPO = 'marccampbell/github-streaming-gif-clock'
COMMENT = '6173052044'

def clip(start, seconds):
    frames = []
    for index in range(seconds):
        image = Image.new('RGB', (640, 160), '#0f172a')
        draw = ImageDraw.Draw(image)
        draw.text((22, 15), (start + timedelta(seconds=index)).strftime('%H:%M:%S UTC'),
                  fill='#4ade80', font=ImageFont.load_default(size=38))
        draw.text((22, 70), f'Published {start:%H:%M:%S} UTC | +{index:02d}s',
                  fill='#e2e8f0', font=ImageFont.load_default(size=21))
        draw.rectangle((22, 125, 22 + int(595 * (index + 1) / seconds), 133), fill='#4ade80')
        frames.append(image)
    output = io.BytesIO()
    # Omit the loop extension: the viewer holds the final frame after playback.
    frames[0].save(output, format='GIF', save_all=True, append_images=frames[1:],
                   duration=1000, optimize=True, disposal=1)
    return output.getvalue()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--updates', type=int, default=20)
    parser.add_argument('--interval', type=int, default=30)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    directory = Path(__file__).parent / 'clips'
    directory.mkdir(exist_ok=True)
    for revision in range(1, args.updates + 1):
        began = time.monotonic()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        name = now.strftime('%Y%m%dT%H%M%SZ') + f'-{revision}.gif'
        (directory / name).write_bytes(clip(now, args.interval))
        url = args.base_url.rstrip('/') + '/clips/' + name
        body = f'''## Versioned clock GIF experiment

![Clock clip revision {revision}]({url})

**Revision {revision}/{args.updates} · published {now:%Y-%m-%d %H:%M:%S} UTC.**

Every {args.interval} seconds this same comment switches to a new, immutable GIF URL. Each clip starts at its publication time, advances for {args.interval} seconds, and holds its final frame without looping. The clock times are generated in advance; this tests image replacement, not a live stream.

Leave this page open. If the revision and image change together without refreshing, GitHub supports the proposed update mechanism. If they stay unchanged, reload to see the latest revision and compare.

This is a bounded {args.updates * args.interval // 60}-minute experiment. After revision {args.updates}, automatic updates stop. GIFs are served outside GitHub through a temporary HTTPS tunnel; they depend on this host staying online.
'''
        subprocess.run(['gh', 'api', f'repos/{REPO}/issues/comments/{COMMENT}',
                        '--method', 'PATCH', '--input', '-'],
                       input=json.dumps({'body': body}), text=True, capture_output=True, check=True)
        print(json.dumps({'revision': revision, 'published': now.isoformat(), 'url': url}), flush=True)
        if revision < args.updates:
            time.sleep(max(0, args.interval - (time.monotonic() - began)))

if __name__ == '__main__':
    main()
