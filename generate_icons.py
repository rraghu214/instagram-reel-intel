#!/usr/bin/env python3
"""
Generate Reel Intel extension icons — pure Python stdlib, no pip required.
Produces icons/icon16.png, icons/icon48.png, icons/icon128.png
Run once from the extension root: python generate_icons.py
"""

import os
import struct
import zlib


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def png_chunk(chunk_type: str, data: bytes) -> bytes:
    ctype = chunk_type.encode('ascii')
    payload = ctype + data
    return struct.pack('>I', len(data)) + payload + struct.pack('>I', crc32(payload))


def make_png(size: int,
             dot_color=(127, 119, 221),   # #7F77DD — Reel Intel purple
             bg_color=(245, 245, 245)) -> bytes:
    """Create a PNG with a circular dot on a light background."""

    # IHDR: width, height, bit_depth=8, color_type=2 (RGB), compress=0, filter=0, interlace=0
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)

    cx = cy = size / 2.0
    outer_r = size * 0.42   # outer circle edge
    inner_r = size * 0.28   # inner lighter circle (gives a subtle depth)

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: None
        for x in range(size):
            dist = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if dist <= inner_r:
                # Slightly lighter centre highlight
                r = min(255, dot_color[0] + 28)
                g = min(255, dot_color[1] + 28)
                b = min(255, dot_color[2] + 28)
                raw.extend([r, g, b])
            elif dist <= outer_r:
                raw.extend(dot_color)
            else:
                raw.extend(bg_color)

    compressed = zlib.compress(bytes(raw), level=9)

    return (
        b'\x89PNG\r\n\x1a\n'
        + png_chunk('IHDR', ihdr_data)
        + png_chunk('IDAT', compressed)
        + png_chunk('IEND', b'')
    )


if __name__ == '__main__':
    os.makedirs('icons', exist_ok=True)

    for sz in [16, 48, 128]:
        path = f'icons/icon{sz}.png'
        with open(path, 'wb') as f:
            f.write(make_png(sz))
        print(f'  OK {path}')

    print('\nIcons generated successfully.')
