#!/usr/bin/env python3
"""
tts.py — Text-to-speech using edge-tts (free Microsoft Edge TTS)
Usage: python3 tts.py "text to speak" output.ogg [--voice en-US-JennyNeural]
"""

import sys
import asyncio
import edge_tts

DEFAULT_VOICE = "en-US-JennyNeural"

async def main():
    if len(sys.argv) < 3:
        print("Usage: python3 tts.py <text> <output_file> [--voice <voice_name>]", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    output = sys.argv[2]

    voice = DEFAULT_VOICE
    if "--voice" in sys.argv:
        idx = sys.argv.index("--voice")
        if idx + 1 < len(sys.argv):
            voice = sys.argv[idx + 1]

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output)
    print(output)

if __name__ == "__main__":
    asyncio.run(main())
