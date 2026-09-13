// Twitch streamer, docs/chess.md "The stream": polls /state, renders frames
// in-process, pipes raw RGB to ffmpeg, which encodes and pushes to RTMP.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { isDrawableState, renderFrame, WIDTH, HEIGHT } from './frame.js';

const STATE_URL = process.env.CHESS_STATE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '8803'}/state`;
const RTMP = process.env.TWITCH_RTMP_URL ?? 'rtmp://live.twitch.tv/app';
const KEY = process.env.TWITCH_STREAM_KEY;
const FPS = Number(process.env.STREAM_FPS ?? '5');
const OUT = process.env.STREAM_OUT ?? (KEY ? `${RTMP}/${KEY}` : '');
if (!OUT) throw new Error('set TWITCH_STREAM_KEY (or STREAM_OUT for a file/other target)');

const ff = spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'warning',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${WIDTH}x${HEIGHT}`, '-r', String(FPS), '-i', 'pipe:0',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
  '-b:v', '1200k', '-maxrate', '1200k', '-bufsize', '2400k', '-g', String(FPS * 2), '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '64k', '-shortest',
  '-f', OUT.startsWith('rtmp') ? 'flv' : 'mp4', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('exit', code => { console.error(`ffmpeg exited ${code}`); process.exit(code ?? 1); });
// When Twitch drops the connection ffmpeg dies and the pipe closes under us:
// log it and exit, systemd restarts the stream after its delay.
ff.stdin.on('error', err => { console.error(`ffmpeg pipe: ${(err as Error).message}`); process.exit(1); });

let state: unknown = null;
async function poll() {
  try {
    const r = await fetch(STATE_URL, { signal: AbortSignal.timeout(5_000) });
    const j = await r.json();
    // A read the frame cannot draw holds the last good one on screen.
    if (isDrawableState(j)) state = j;
    else console.error('state poll returned a payload that is not a feed state; holding the last frame');
  } catch (e) { console.error('state poll failed', (e as Error).message); }
}
setInterval(poll, 1000); await poll();

const interval = 1000 / FPS;
let next = Date.now();
function frame() {
  if (state) {
    // One frame must never take the stream down.
    let buf: Buffer | null = null;
    try { buf = renderFrame(state); } catch (e) { console.error('frame failed, skipping it:', (e as Error).message); }
    if (buf && !ff.stdin.write(buf)) { ff.stdin.once('drain', schedule); return; }
  }
  schedule();
}
function schedule() { next += interval; setTimeout(frame, Math.max(0, next - Date.now())); }
frame();
