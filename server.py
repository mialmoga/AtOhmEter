#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════
#  AtOhmEter — Motor Server
#  Servidor WebSocket para motores de física Python/NumPy
#
#  Protocolo entrada:
#    init          { type, engine, N, config, currentSeed }
#    step          { type, n? }
#    seed          { type, id }
#    inject        { type, id }
#    config_update { type, param, value }
#    pause         { type }
#    resume        { type }
#
#  Protocolo salida:
#    ready  { type, engine, N, T }
#    frame  [binary: MAGIC 4B + frame_n 4B + T 4B + vol T*4B + phase T*4B]
#    error  { type, message }
#
#  Para agregar un motor: crear engines/{id}/compute.py
#  Este servidor no necesita modificarse nunca.
#
#  Requiere: pip install websockets numpy
# ══════════════════════════════════════════════════════════════

import asyncio
import json
import struct
import importlib.util
import os
import numpy as np
import websockets
from collections import deque

HOST = 'localhost'
PORT = 8765

# ── Cargar compute.py dinámicamente ──────────────────────────
def load_engine_module(engine_id):
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, 'engines', engine_id, 'compute.py')
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No se encontró engines/{engine_id}/compute.py"
        )
    spec   = importlib.util.spec_from_file_location(f'engine_{engine_id}', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# ── Empaquetar buffer binario ─────────────────────────────────
# [MAGIC 4B][frame_n u32][T u32][meta_len u32][meta JSON utf8 meta_len B][vol T*f32][phase T*f32]
#
# El bloque meta es JSON arbitrario decidido por el motor (no por el server):
#   { "metrics": {...claves del motor...}, "state": "..." }
# meta_len == 0  → frame sin métricas; el shell no toca el HUD.
# Mantener métricas atómicas con su frame es el punto: viajan en el MISMO mensaje,
# así nunca se desincroniza el stat respecto al volumen pintado.
MAGIC = b'ATOH'

def pack_frame(render_volume, phase_data, frame_n, meta=None):
    T = len(render_volume)
    if meta:
        meta_bytes = json.dumps(meta, separators=(',', ':')).encode('utf-8')
    else:
        meta_bytes = b''
    hdr = struct.pack('<4sIII', MAGIC, frame_n, T, len(meta_bytes))
    return hdr + meta_bytes \
               + render_volume.astype(np.float32).tobytes() \
               + phase_data.astype(np.float32).tobytes()

# Recoger métricas + estado del motor de forma agnóstica.
# Si el motor no las expone o lanza, devolvemos None y el frame sale sin meta
# (degradación elegante: el server nunca se cae por culpa de las métricas).
def collect_meta(engine):
    try:
        m = engine['getMetrics']()
        state = engine['classifyState'](m) if 'classifyState' in engine else None
        return {'metrics': m, 'state': state}
    except Exception as e:
        print(f'    [!] meta no disponible: {e}')
        return None

# ── Sesión por cliente ────────────────────────────────────────
class Session:
    def __init__(self):
        self.engine        = None
        self.N             = 0
        self.T             = 0
        self.render_volume = None
        self.phase_data    = None
        self.frame_n       = 0
        self.paused        = False
        self.engine_id     = ''
        # Cola de steps pendientes
        self.step_queue    = deque()
        self.processing    = False

    def init(self, engine_id, N, config, seed):
        self.N         = N
        self.T         = N ** 3
        self.frame_n   = 0
        self.paused    = False
        self.engine_id = engine_id
        self.step_queue.clear()
        self.processing = False

        self.render_volume = np.zeros(self.T, dtype=np.float32)
        self.phase_data    = np.zeros(self.T, dtype=np.float32)

        module = load_engine_module(engine_id)
        self.engine = module.createEngine(N, self.render_volume, self.phase_data)

        if config:
            self.engine['applyParams'](config)
        if seed:
            self.engine['seed'](seed)
        self.engine['refresh']()

    def _step_once(self):
        self.engine['step']()
        self.engine['refresh']()
        self.frame_n += 1

    def step(self, n=1):
        if self.paused:
            return None
        for _ in range(n):
            self._step_once()
        if self.frame_n % 100 == 0:
            print(f'    [{self.engine_id}] frame {self.frame_n}')
        meta = collect_meta(self.engine)
        return pack_frame(self.render_volume, self.phase_data, self.frame_n, meta)

    def seed(self, seed_id):
        print(f'    [{self.engine_id}] seed → {seed_id}')
        self.engine['seed'](seed_id)
        self.engine['refresh']()
        self.frame_n = 0
        meta = collect_meta(self.engine)
        return pack_frame(self.render_volume, self.phase_data, self.frame_n, meta)

    def inject(self, injection_id, data=None):
        print(f'    [{self.engine_id}] inject → {injection_id}')
        self.engine['inject'](injection_id, data)
        self.engine['refresh']()
        meta = collect_meta(self.engine)
        return pack_frame(self.render_volume, self.phase_data, self.frame_n, meta)

    def config_update(self, param, value):
        print(f'    [{self.engine_id}] config → {param} = {value}')
        self.engine['applyParams']({param: value})

    def pause(self):
        self.paused = True
        print(f'    [{self.engine_id}] ⏸ pausado en frame {self.frame_n}')

    def resume(self):
        self.paused = False
        print(f'    [{self.engine_id}] ▶ reanudado desde frame {self.frame_n}')

# ── Handler por conexión ──────────────────────────────────────
async def handler(websocket):
    session = Session()
    addr    = websocket.remote_address
    print(f'[+] Conectado: {addr}')

    # Cola async de steps para no acumular de golpe
    step_queue = asyncio.Queue()
    processing = False

    async def process_steps():
        nonlocal processing
        processing = True
        while not step_queue.empty():
            n = await step_queue.get()
            if session.engine is None or session.paused:
                continue
            try:
                buf = session.step(n)
                if buf is not None:
                    await websocket.send(buf)
            except Exception as e:
                print(f'    [!] Error en step: {e}')
        processing = False

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except Exception:
                await websocket.send(json.dumps({
                    'type': 'error', 'message': 'JSON inválido'
                }))
                continue

            t = msg.get('type', '')

            # ── init ──────────────────────────────────────────
            if t == 'init':
                engine_id = msg.get('engine', '')
                N         = int(msg.get('N', 24))
                config    = msg.get('config', {})
                seed      = msg.get('currentSeed', '')
                print(f'    [init] motor="{engine_id}" N={N} seed="{seed}"')
                try:
                    session.init(engine_id, N, config, seed)
                    await websocket.send(json.dumps({
                        'type':   'ready',
                        'engine': engine_id,
                        'N':      N,
                        'T':      session.T,
                    }))
                    buf = pack_frame(
                        session.render_volume,
                        session.phase_data,
                        session.frame_n,
                        collect_meta(session.engine)
                    )
                    await websocket.send(buf)
                    print(f'    [ok] T={session.T} — listo')
                except FileNotFoundError as e:
                    print(f'    [!] {e}')
                    await websocket.send(json.dumps({
                        'type': 'error', 'message': str(e)
                    }))
                except Exception as e:
                    import traceback
                    print(f'    [!] Error init: {e}')
                    traceback.print_exc()
                    await websocket.send(json.dumps({
                        'type': 'error', 'message': f'Error init: {e}'
                    }))

            # ── step ──────────────────────────────────────────
            elif t == 'step':
                if session.engine is None or session.paused:
                    continue
                n = int(msg.get('n', 1))
                # Encolar — si ya estamos procesando, acumula sin perder
                await step_queue.put(n)
                if not processing:
                    asyncio.ensure_future(process_steps())

            # ── pause / resume ────────────────────────────────
            elif t == 'pause':
                session.pause()

            elif t == 'resume':
                session.resume()

            # ── seed ──────────────────────────────────────────
            elif t == 'seed':
                if session.engine is None:
                    continue
                buf = session.seed(msg.get('id', ''))
                await websocket.send(buf)

            # ── inject ────────────────────────────────────────
            elif t == 'inject':
                if session.engine is None:
                    continue
                buf = session.inject(msg.get('id', ''), msg.get('data'))
                await websocket.send(buf)

            # ── config_update ─────────────────────────────────
            elif t == 'config_update':
                if session.engine is None:
                    continue
                session.config_update(
                    msg.get('param', ''),
                    msg.get('value', 0)
                )

            else:
                print(f'    [?] Tipo desconocido: {t}')
                await websocket.send(json.dumps({
                    'type': 'error', 'message': f'Tipo desconocido: {t}'
                }))

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        import traceback
        print(f'[!] Error en sesión {addr}: {e}')
        traceback.print_exc()
    finally:
        print(f'[-] Desconectado: {addr}')

# ── Main ──────────────────────────────────────────────────────
async def main():
    print('╔══════════════════════════════════════╗')
    print('║   AtOhmEter — Motor Server           ║')
    print(f'║   ws://{HOST}:{PORT}                    ║')
    print('║   engines/*/compute.py               ║')
    print('╚══════════════════════════════════════╝')
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nServidor detenido.')
