#!/usr/bin/env python3
"""Дополнение к скиллу: бесплатная локальная озвучка на английском + тайминги слов.

Делает ровно то, что ждёт mix.py:  voice/voice.wav (48 кГц, 16 бит, моно)  и  voice/words.json  [{"w","s","e"}].
Без аккаунтов и ключей: Kokoro-82M (Apache-2.0, через kokoro-onnx) читает текст, faster-whisper (MIT) даёт времена слов.

Установка (один раз, на Mac):
    python3 -m venv ~/kokoro-venv && source ~/kokoro-venv/bin/activate
    pip install kokoro-onnx faster-whisper soundfile numpy
    mkdir -p ~/kokoro-models && cd ~/kokoro-models
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
Запуск (синтез):
    python voice_kokoro.py SCRIPT.txt ~/bridge-short/voice [--voice am_adam] [--speed 1.3]
Если озвучка уже есть (ElevenLabs, свой голос):  python voice_kokoro.py - ~/bridge-short/voice --audio my_voice.mp3
SCRIPT.txt: чистый английский текст озвучки (только то, что произносится), можно по предложению на строку.
Числа пишите так, как они произносятся ("seventy-four", "eighteen thirty-one").
Темп: --speed 1.3 даёт ~3.6 слова/с (как у донора, 3.5-4.1); проверено на 219 словах: 1.0 даёт 2.9 слова/с.
Голоса: am_adam (США, муж. — по умолчанию, выбран владельцем 05.11), am_michael (США, муж., ровный), am_puck, am_fenrir, bm_george (UK, документальный), af_heart (жен.).
"""
import argparse, json, os, re, subprocess, sys
import numpy as np
import soundfile as sf

MODELS = os.environ.get("KOKORO_DIR", os.path.expanduser("~/kokoro-models"))
SR_OUT = 48000  # mix.py: assert sr == SR (48 kHz)


def synth(a, out):
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))
    text = open(a.script, encoding="utf-8").read()
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]
    lang = "en-gb" if a.voice.startswith("b") else "en-us"
    parts, sr = [np.zeros(1)], 24000
    for s in sents:
        x, sr = k.create(s, voice=a.voice, speed=a.speed, lang=lang)
        parts += [np.asarray(x, dtype=np.float32), np.zeros(int(a.gap * sr), np.float32)]
    parts[0] = np.zeros(int(a.lead * sr), np.float32)
    y = np.concatenate(parts[:-1]); y = y / (np.abs(y).max() + 1e-9) * 0.9
    tmp = os.path.join(a.outdir, "_voice_24k.wav"); sf.write(tmp, y, sr, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-ar", str(SR_OUT), "-ac", "1", "-sample_fmt", "s16", out], check=True)
    os.remove(tmp)
    return y, sr, sents


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script", nargs="?"); ap.add_argument("outdir")
    ap.add_argument("--audio", help="готовая озвучка (mp3/wav/m4a: ElevenLabs, свой голос): без синтеза, только 48 кГц + words.json")
    ap.add_argument("--voice", default="am_adam"); ap.add_argument("--speed", type=float, default=1.3)
    ap.add_argument("--gap", type=float, default=0.05, help="пауза между предложениями, сек")
    ap.add_argument("--lead", type=float, default=0.05, help="тишина в начале (у донора голос с 1-4 кадра)")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    out = os.path.join(a.outdir, "voice.wav")
    if a.audio:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.audio, "-ar", str(SR_OUT), "-ac", "1", "-sample_fmt", "s16", out], check=True)
        y, sr, sents = sf.read(out)[0], SR_OUT, []
    else:
        y, sr, sents = synth(a, out)
    from faster_whisper import WhisperModel
    segs, _ = WhisperModel("small.en", device="cpu", compute_type="int8").transcribe(out, word_timestamps=True, language="en")
    words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for sg in segs for w in sg.words]
    json.dump(words, open(os.path.join(a.outdir, "words.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{out}: {len(y)/sr:.2f} s, {len(sents)} предложений, {len(words)} слов -> words.json")
    print("Проверьте words.json глазами: SKILL.md требует поправить тайминги руками (Whisper слышит не всё).")


if __name__ == "__main__":
    sys.exit(main())
