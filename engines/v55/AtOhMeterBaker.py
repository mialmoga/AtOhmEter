# ============================================================
# AtOhmEter Baker v5.56+
# ------------------------------------------------------------
# Procedural Refactor Edition
#
# ✔ Preset mode intact
# ✔ Procedural universes
# ✔ Structural bias
# ✔ Optional normalization
# ✔ Real procedural recipes
# ✔ Snapshot-count workflow
# ✔ Initial frame protection
# ✔ Full v5.56 compatibility
#
# ============================================================

import json
import math
import random
import hashlib

from datetime import (
    datetime,
    UTC
)

import numpy as np


# ============================================================
# MODES
# ============================================================

MODES = {

    "orbital": {
        "snap_bias": 0.45,
        "noise": 0.015,
        "helicity": 0.08,
        "threshold": 0.18,
    },

    "halo": {
        "snap_bias": 0.65,
        "noise": 0.008,
        "helicity": 0.12,
        "threshold": 0.12,
    },

    "plasma": {
        "snap_bias": 0.82,
        "noise": 0.03,
        "helicity": 0.18,
        "threshold": 0.08,
    },

    "cristal": {
        "snap_bias": 0.92,
        "noise": 0.004,
        "helicity": 0.22,
        "threshold": 0.28,
    },

    "cosmos": {
        "snap_bias": 0.35,
        "noise": 0.045,
        "helicity": 0.04,
        "threshold": 0.09,
    },

    "nube": {
        "snap_bias": 0.20,
        "noise": 0.07,
        "helicity": 0.02,
        "threshold": 0.05,
    }
}


# ============================================================
# PROCEDURAL RECIPES
# ============================================================

PROCEDURAL_RECIPES = {

    "a": {
        "name": "spiral",
        "injector": "helical",
        "gain": 1.2,
    },

    "b": {
        "name": "filament",
        "injector": "filament",
        "gain": 0.9,
    },

    "c": {
        "name": "cluster",
        "injector": "nodes",
        "gain": 1.5,
    },

    "d": {
        "name": "void",
        "injector": "cavity",
        "gain": 1.8,
    },

    "e": {
        "name": "shell",
        "injector": "shell",
        "gain": 1.0,
    }
}


# ============================================================
# HELPERS
# ============================================================


def stable_seed(text):

    h = hashlib.sha256(
        text.encode()
    ).hexdigest()

    return int(h[:8], 16)



def normalize(a):

    m = np.max(np.abs(a))

    if m < 1e-9:
        return a

    return a / m



def lap3(a):

    return (
        np.roll(a, 1, 0)
        + np.roll(a, -1, 0)
        + np.roll(a, 1, 1)
        + np.roll(a, -1, 1)
        + np.roll(a, 1, 2)
        + np.roll(a, -1, 2)
        - 6 * a
    )



def curl(U, V, W):

    dWdy = np.roll(W, -1, 1) - np.roll(W, 1, 1)
    dVdz = np.roll(V, -1, 2) - np.roll(V, 1, 2)

    dUdz = np.roll(U, -1, 2) - np.roll(U, 1, 2)
    dWdx = np.roll(W, -1, 0) - np.roll(W, 1, 0)

    dVdx = np.roll(V, -1, 0) - np.roll(V, 1, 0)
    dUdy = np.roll(U, -1, 1) - np.roll(U, 1, 1)

    cx = dWdy - dVdz
    cy = dUdz - dWdx
    cz = dVdx - dUdy

    return cx, cy, cz



def magnitude(U, V, W):

    return np.sqrt(U*U + V*V + W*W)



def helicity(U, V, W, cU, cV, cW):

    return np.mean(
        U*cU + V*cV + W*cW
    )



def estimate_vortices(
    cU,
    cV,
    cW,
    thresh
):

    mag = magnitude(
        cU,
        cV,
        cW
    )

    return int(
        np.sum(mag > thresh)
    )


# ============================================================
# PROCEDURAL FIELD
# ============================================================


def procedural_field(
    seed_code,
    dx,
    dy,
    dz,
    r,
    a,
    bias
):

    field = 0.0

    for symbol in seed_code:

        if symbol not in PROCEDURAL_RECIPES:
            continue

        recipe = PROCEDURAL_RECIPES[symbol]

        gain = recipe["gain"]

        if recipe["injector"] == "helical":

            field += (
                math.sin(r*0.35 - a*3.0)
                * gain
            )

        elif recipe["injector"] == "filament":

            field += (
                math.cos(dx*0.15)
                * math.sin(dz*0.22)
                * gain
            )

        elif recipe["injector"] == "nodes":

            field += (
                math.sin(dx*0.3)
                * math.sin(dy*0.3)
                * math.sin(dz*0.3)
                * gain
            )

        elif recipe["injector"] == "cavity":

            field -= (
                math.exp(-r*0.05)
                * gain
            )

        elif recipe["injector"] == "shell":

            shell_r = 12.0

            field += (
                math.exp(
                    -abs(r-shell_r)*0.2
                )
                * gain
            )

    field *= (
        1.0 + bias*0.8
    )

    return field


# ============================================================
# PARAM SOLVER
# ============================================================


def generate_params(
    N,
    mode,
    snap,
    bias=0.0
):

    profile = MODES[mode]

    snap = np.clip(
        snap + bias * 0.15,
        0.0,
        1.0
    )

    density_scale = (
        (N / 32.0) ** 1.35
    )

    ETA = (
        0.18
        + snap * 0.9
    ) * density_scale

    LAMBDA = (
        0.03
        + snap * 0.12
    )

    BOHM_C = (
        0.35
        + snap * 0.85
    )

    HELIC_FEEDBACK = (
        profile["helicity"]
        + snap * 0.25
    )

    DAMP_BASE = (
        0.985
        + snap * 0.01
    )

    DAMP_VORT = (
        0.996
        + snap * 0.003
    )

    GAMMA = (
        0.02
        + snap * 0.22
    )

    DT = (
        0.0018
        - snap * 0.0008
    )

    THRESH = (
        profile["threshold"]
        + snap * 0.18
    )

    VORTEX_THRESH = (
        0.3
        + snap * 1.8
    )

    NOISE = profile["noise"]

    return {

        "ETA": ETA,
        "LAMBDA": LAMBDA,
        "BOHM_C": BOHM_C,
        "HELIC_FEEDBACK": HELIC_FEEDBACK,
        "DAMP_BASE": DAMP_BASE,
        "DAMP_VORT": DAMP_VORT,
        "GAMMA": GAMMA,
        "DT": DT,
        "THRESH": THRESH,
        "VORTEX_THRESH": VORTEX_THRESH,
        "NOISE": NOISE,
    }


# ============================================================
# SEED INJECTION
# ============================================================


def inject_seed(
    U,
    V,
    W,
    mode,
    seed_code=None,
    procedural=False,
    bias=0.0,
    auto_normalize=True
):

    rng = random.Random(
        stable_seed(
            seed_code or mode
        )
    )

    N = U.shape[0]

    cx = N // 2
    cy = N // 2
    cz = N // 2

    for x in range(N):
        for y in range(N):
            for z in range(N):

                dx = x - cx
                dy = y - cy
                dz = z - cz

                r = math.sqrt(
                    dx*dx
                    + dy*dy
                    + dz*dz
                ) + 1e-6

                a = math.atan2(dy, dx)

                if procedural:

                    s = procedural_field(
                        seed_code,
                        dx,
                        dy,
                        dz,
                        r,
                        a,
                        bias
                    )

                else:

                    if mode == "orbital":

                        s = math.sin(
                            r*0.8 - a*2.0
                        )

                    elif mode == "halo":

                        s = math.cos(r*0.45)

                    elif mode == "plasma":

                        s = rng.uniform(-1,1)

                    elif mode == "cristal":

                        s = (
                            math.sin(dx*0.4)
                            * math.cos(dy*0.4)
                        )

                    elif mode == "cosmos":

                        s = math.sin(r*0.15)

                    else:

                        s = rng.uniform(
                            -0.2,
                            0.2
                        )

                envelope = math.exp(
                    -r * 0.06
                )

                envelope *= (
                    1.0 + bias*0.5
                )

                s *= (
                    1.0 + bias*0.3
                )

                U[x,y,z] += (
                    s * envelope
                )

                V[x,y,z] += (
                    s * envelope * 0.8
                )

                W[x,y,z] += (
                    s * envelope * 0.6
                )

    if auto_normalize:

        return (
            normalize(U),
            normalize(V),
            normalize(W)
        )

    return U,V,W


# ============================================================
# EVOLUTION
# ============================================================


def evolve(
    U,
    V,
    W,
    p
):

    cU, cV, cW = curl(
        U,
        V,
        W
    )

    rho = magnitude(
        U,
        V,
        W
    )

    rho_safe = np.clip(
        rho,
        1e-6,
        None
    )

    logrho = np.log(rho_safe)

    bohm = (
        -(p["BOHM_C"] / 4.0)
        * lap3(logrho)
    )

    higgs = (
        p["LAMBDA"]
        * (rho - 1.0)
    )

    snap_force = (
        p["ETA"]
        * magnitude(
            cU,
            cV,
            cW
        )
    )

    vort_mag = magnitude(
        cU,
        cV,
        cW
    )

    t = np.clip(
        vort_mag
        / p["VORTEX_THRESH"],
        0,
        1
    )

    local_damp = (
        p["DAMP_BASE"]
        + (
            p["DAMP_VORT"]
            - p["DAMP_BASE"]
        ) * t
    )

    noise = (
        np.random.randn(*U.shape)
        * p["NOISE"]
    )

    dU = (
        p["DT"]
        * (
            lap3(U)
            + bohm
            - higgs
            + cU
            * p["HELIC_FEEDBACK"]
            + snap_force
        )
    )

    dV = (
        p["DT"]
        * (
            lap3(V)
            + bohm
            - higgs
            + cV
            * p["HELIC_FEEDBACK"]
            + snap_force
        )
    )

    dW = (
        p["DT"]
        * (
            lap3(W)
            + bohm
            - higgs
            + cW
            * p["HELIC_FEEDBACK"]
            + snap_force
        )
    )

    U = (
        U + dU + noise
    ) * local_damp

    V = (
        V + dV + noise
    ) * local_damp

    W = (
        W + dW + noise
    ) * local_damp

    return (

        np.clip(U, -4, 4),
        np.clip(V, -4, 4),
        np.clip(W, -4, 4),
        cU,
        cV,
        cW
    )


# ============================================================
# SNAPSHOT
# ============================================================


def build_snapshot(

    frame,

    U,
    V,
    W,

    cU,
    cV,
    cW,

    p,

    N,

    seed_code,

    bias
):

    vort = estimate_vortices(

        cU,
        cV,
        cW,

        p["VORTEX_THRESH"]
    )

    energy = np.mean(
        magnitude(U,V,W)
    )

    return {

        "frame": frame,
        "seed": seed_code,
        "bias": bias,

        "energy": float(energy),

        "helicity": float(
            helicity(
                U,V,W,
                cU,cV,cW
            )
        ),

        "psiMax": float(
            np.max(
                magnitude(U,V,W)
            )
        ),

        "vortices": vort,

        "N": N,

        "ETA": p["ETA"],
        "LAMBDA": p["LAMBDA"],
        "BOHM_C": p["BOHM_C"],
        "HELIC_FEEDBACK": p["HELIC_FEEDBACK"],
        "DAMP_BASE": p["DAMP_BASE"],
        "DAMP_VORT": p["DAMP_VORT"],
        "GAMMA": p["GAMMA"],
        "DT": p["DT"],
        "THRESH": p["THRESH"],
        "VORTEX_THRESH": p["VORTEX_THRESH"],

        "U": U.flatten().tolist(),
        "Ui": cU.flatten().tolist(),
        "V": V.flatten().tolist(),
        "Vi": cV.flatten().tolist(),
        "W": W.flatten().tolist(),
        "Wi": cW.flatten().tolist(),
    }


# ============================================================
# MAIN
# ============================================================

print("\n=== AtOhmEter Baker v5.56+ ===\n")

print("Tipo de generación:")
print("[1] Preset clásico")
print("[2] Procedural seed")

GEN_MODE = input("\nSelecciona: ").strip()

N = int(
    input("\nResolución (32/48/64): ")
)

procedural = False

if GEN_MODE == "1":

    print("\nModos:\n")

    for k in MODES:
        print("-", k)

    mode = input("\nModo: ").strip().lower()

    seed_code = (
        mode
        + str(
            random.randint(
                0,
                99999
            )
        )
    )

else:

    procedural = True

    print("\nProcedural recipes:")
    print("a = spiral")
    print("b = filament")
    print("c = cluster")
    print("d = void")
    print("e = shell")

    seed_code = input("\nSeed code: ").strip()

    mode = "orbital"

snap = float(
    input("\nValor SNAP (0.0 - 1.0): ")
)

bias = float(
    input("\nBias (-1.0 a +1.0): ")
)

SAVE_EVERY = int(
    input("\nGuardar cada cuantos frames?: ")
)

SNAP_COUNT = int(
    input(
        "Snapshots a guardar: "
    )
)

TOTAL_FRAMES = (
    SNAP_COUNT
    * SAVE_EVERY
)

WARMUP = int(
    input(
        "Warmup iterations: "
    )
)

SAVE_INITIAL = input(
    "Guardar frame inicial? y/n: "
).strip().lower()

AUTO_NORMALIZE = input(
    "Auto normalize? y/n: "
).strip().lower() == "y"

seed_int = stable_seed(
    seed_code
)

random.seed(seed_int)
np.random.seed(seed_int)

p = generate_params(

    N,
    mode,
    snap,
    bias
)

print("\nParámetros:\n")

for k,v in p.items():

    print(f"{k}: {v}")

U = np.zeros(
    (N,N,N),
    dtype=np.float32
)

V = np.zeros(
    (N,N,N),
    dtype=np.float32
)

W = np.zeros(
    (N,N,N),
    dtype=np.float32
)

U,V,W = inject_seed(

    U,
    V,
    W,

    mode,

    seed_code,

    procedural,

    bias,

    AUTO_NORMALIZE
)

snapshots = []

frame = 0

if SAVE_INITIAL == "y":

    cU,cV,cW = curl(U,V,W)

    snapshots.append(

        build_snapshot(

            frame,

            U,V,W,

            cU,cV,cW,

            p,

            N,

            seed_code,

            bias
        )
    )

print("\nWarmup...\n")

for i in range(WARMUP):

    U,V,W,cU,cV,cW = evolve(
        U,V,W,p
    )

    if i % 100 == 0:

        print(
            f"warmup {i}"
        )

frame = WARMUP

print("\nCocinando...\n")

for frame_i in range(
    TOTAL_FRAMES
):

    U,V,W,cU,cV,cW = evolve(
        U,V,W,p
    )

    if frame_i % SAVE_EVERY == 0:

        snapdata = build_snapshot(

            frame,

            U,
            V,
            W,

            cU,
            cV,
            cW,

            p,

            N,

            seed_code,

            bias
        )

        snapshots.append(
            snapdata
        )

        print(

            f"[{frame}] "

            f"E={snapdata['energy']:.4f} "

            f"V={snapdata['vortices']} "

            f"H={snapdata['helicity']:.4f}"
        )

        frame += SAVE_EVERY

export = {

    "version":
        "AtOhmEter_v5.56+",

    "exported":
        datetime.now(UTC)
        .isoformat(),

    "count":
        len(snapshots),

    "snapshots":
        snapshots,
}

filename = (

    f"atohmeter_"

    f"{seed_code}_"

    f"N{N}_"

    f"{len(snapshots)}snaps.json"
)

with open(filename, "w") as f:

    json.dump(export, f)

print("\n================================")
print("EXPORTADO:")
print(filename)
print("================================\n")