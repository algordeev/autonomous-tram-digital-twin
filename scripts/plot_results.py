"""Publication figures for docs/RESULTS.md from the sensitivity-sweep outputs.

Requires pandas and matplotlib only:

    python3 -m pip install pandas matplotlib
    python3 scripts/plot_results.py

Reads outputs/sweeps/results.csv and outputs/sweeps/izmir-baseline-grid-power.csv
(written by `npm run benchmark:sweeps`) and writes PNG (300 dpi) and SVG files
to docs/assets/results/. Figures carry no titles; captions live in the docs.
Every series is told apart by colour and by a second cue (hatch, marker or
line style), so the figures stay readable in greyscale.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RESULTS = ROOT / "outputs" / "sweeps" / "results.csv"
DEFAULT_SERIES = ROOT / "outputs" / "sweeps" / "izmir-baseline-grid-power.csv"
DEFAULT_OUT = ROOT / "docs" / "assets" / "results"
DEFAULT_AUTOMATION = ROOT / "outputs" / "automation"
# Regulation on/off in the automation figures; service/emergency braking in fig 7.
ON_STYLE = {"color": "#2a78d6", "marker": "o", "linestyle": "-"}
OFF_STYLE = {"color": "#eb6834", "marker": "s", "linestyle": "--"}

NETWORKS = [
    ("izmir-konak", "İzmir Konak"),
    ("nizhny-route-2", "Nizhny Route 2"),
    ("nizhny-routes-2-21", "Nizhny Routes 2+21"),
]
# Fixed categorical order; each strategy also has its own hatch, marker and dash.
STYLE = {
    "none": {"label": "No storage", "color": "#7a7974", "marker": "^", "linestyle": ":", "hatch": ""},
    "reactive": {"label": "Reactive flywheel", "color": "#2a78d6", "marker": "o", "linestyle": "-", "hatch": ""},
    "predictive": {"label": "Predictive controller", "color": "#eb6834", "marker": "s", "linestyle": "--", "hatch": "////"},
}
INK = "#1f1e1c"
INK_SECONDARY = "#52514e"
GRID = "#e4e3dd"

BASELINE = {
    "start_minute": 480,
    "warmup_min": 10,
    "window_min": 60,
    "storage_scale": 1.0,
    "eta_scale": 1.0,
    "timestep_ms": 50,
}


def style_axes(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(INK_SECONDARY)
        ax.spines[side].set_linewidth(0.8)
    ax.tick_params(colors=INK_SECONDARY, labelcolor=INK, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def save(fig, out_dir: Path, name: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for suffix, kwargs in ((".png", {"dpi": 300}), (".svg", {})):
        fig.savefig(out_dir / f"{name}{suffix}", bbox_inches="tight", facecolor="white", **kwargs)
    plt.close(fig)
    print(f"wrote {out_dir / name}.png/.svg")


def at_baseline(df: pd.DataFrame, except_for: str | None = None) -> pd.DataFrame:
    mask = pd.Series(True, index=df.index)
    for column, value in BASELINE.items():
        if column != except_for:
            mask &= df[column].astype(float) == float(value)
    if except_for != "tram_count_requested":
        mask &= df["tram_count_requested"].astype(str) == "default"
    return df[mask]


# Reactive-flywheel metrics, each against the no-storage reference. Colour follows the
# metric in every figure; hatch and marker repeat the distinction for greyscale.
METRICS = [
    {"column": "energy_saving_pct", "label": "Grid-energy saving", "color": "#2a78d6", "hatch": "", "marker": "o", "linestyle": "-"},
    {"column": "peak_15min_reduction_pct", "label": "15-min peak reduction", "color": "#1baf7a", "hatch": "\\\\\\\\", "marker": "D", "linestyle": "-."},
    {"column": "peak_reduction_pct", "label": "Instantaneous peak reduction", "color": "#eb6834", "hatch": "////", "marker": "s", "linestyle": "--"},
]


def fig1_savings_by_network(df: pd.DataFrame, out_dir: Path) -> None:
    """Reactive only: the rule-based predictive variant equals it (caption footnote)."""
    base = at_baseline(df)
    base = base[base["strategy"] == "reactive"]
    fig, ax = plt.subplots(figsize=(7.2, 3.3))
    width = 0.26
    gap = 0.02
    for offset, metric in enumerate(METRICS):
        xs, ys = [], []
        for index, (scenario, _) in enumerate(NETWORKS):
            row = base[base["scenario"] == scenario]
            if row.empty:
                continue
            xs.append(index + (offset - (len(METRICS) - 1) / 2) * (width + gap))
            ys.append(float(row[metric["column"]].iloc[0]))
        bars = ax.bar(xs, ys, width, color=metric["color"], hatch=metric["hatch"], edgecolor="white",
                      linewidth=0.6, label=metric["label"])
        for bar, value in zip(bars, ys):
            ax.annotate(f"{value:.1f}", (bar.get_x() + bar.get_width() / 2, max(value, 0)),
                        xytext=(0, 2), textcoords="offset points", ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(range(len(NETWORKS)))
    ax.set_xticklabels([label for _, label in NETWORKS], fontsize=8.5)
    ax.set_ylabel("Change relative to no storage (%)", fontsize=9, color=INK)
    ax.axhline(0, color=INK_SECONDARY, linewidth=0.8)
    top = max(base[[m["column"] for m in METRICS]].astype(float).max()) * 1.3
    ax.set_ylim(0, top)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, loc="upper left", ncol=3)
    fig.tight_layout()
    save(fig, out_dir, "fig1_savings_by_network")


def fig2_izmir_grid_power(series: pd.DataFrame, df: pd.DataFrame, out_dir: Path) -> None:
    """Full window (a) and a zoom around the no-storage peak (b).

    The series is sampled every 1 s, so it can miss the true window peak,
    which the core records at every 50 ms step; the horizontal lines and
    labels use those recorded peaks from results.csv.
    """
    base = at_baseline(df)
    base = base[base["scenario"] == "izmir-konak"]
    peaks = {strategy: float(base[base["strategy"] == strategy]["peak_kw"].iloc[0]) for strategy in ("none", "reactive")}
    minutes = series["t_s"] / 60.0
    peak_minute = float(minutes[series["none_kw"].idxmax()])
    zoom = (max(0.0, peak_minute - 2.5), min(float(minutes.iloc[-1]), peak_minute + 2.5))

    fig, axes = plt.subplots(2, 1, figsize=(7.2, 4.8), gridspec_kw={"height_ratios": [1, 1.15]})
    for panel, (ax, lim, width) in enumerate(zip(axes, [(0.0, float(minutes.iloc[-1])), zoom], [0.5, 1.3])):
        for strategy, column in (("none", "none_kw"), ("reactive", "reactive_kw")):
            style = STYLE[strategy]
            ax.plot(minutes, series[column], color=style["color"], linewidth=width,
                    label=style["label"], zorder=3 if strategy == "reactive" else 2)
            ax.axhline(peaks[strategy], color=style["color"], linewidth=1.0,
                       linestyle=":" if strategy == "none" else "--", zorder=4)
            if panel == 1:
                ax.annotate(f"window peak {peaks[strategy]:.0f} kW", (lim[1], peaks[strategy]), xytext=(4, 0),
                            textcoords="offset points", va="center", fontsize=8, color=INK)
        ax.set_xlim(*lim)
        ax.set_ylim(0, max(peaks.values()) * 1.16)
        ax.set_ylabel("Grid power (kW)", fontsize=9, color=INK)
        ax.text(0.005, 0.97, "(a)" if panel == 0 else "(b)", transform=ax.transAxes, va="top", fontsize=9, color=INK)
        style_axes(ax)
    axes[0].axvspan(*zoom, color=GRID, alpha=0.6, zorder=1, linewidth=0)
    axes[1].set_xlabel("Time into measured window (min)", fontsize=9, color=INK)
    axes[0].legend(frameon=False, fontsize=8.5, loc="lower left", bbox_to_anchor=(0.0, 1.0), ncol=2)
    fig.tight_layout()
    save(fig, out_dir, "fig2_izmir_grid_power")


def fig3_sensitivity_fleet(df: pd.DataFrame, out_dir: Path) -> None:
    fleet = at_baseline(df, except_for="tram_count_requested")
    fleet = fleet[(fleet["scenario"] == "izmir-konak") & (fleet["tram_count_requested"].astype(str) != "default")].copy()
    fleet["tram_count"] = fleet["tram_count"].astype(int)
    fig, ax = plt.subplots(figsize=(5.4, 3.2))
    for strategy in ("reactive",):
        style = STYLE[strategy]
        rows = fleet[fleet["strategy"] == strategy].sort_values("tram_count")
        ax.plot(rows["tram_count"], rows["energy_saving_pct"].astype(float), color=style["color"],
                marker=style["marker"], markersize=6, linestyle=style["linestyle"], linewidth=1.6, label=style["label"])
    counts = sorted(fleet["tram_count"].unique())
    reference = fleet[fleet["strategy"] == "none"].set_index("tram_count")["mean_headway_s"]
    labels = []
    for count in counts:
        headway = pd.to_numeric(reference.get(count), errors="coerce")
        labels.append(f"{count}\n{headway / 60:.1f} min" if pd.notna(headway) else str(count))
    ax.set_xticks(counts)
    ax.set_xticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Trams in service (upper) and mean terminal headway (lower)", fontsize=9, color=INK)
    ax.set_ylabel("Grid-energy saving (%)", fontsize=9, color=INK)
    style_axes(ax)
    fig.tight_layout()
    save(fig, out_dir, "fig3_sensitivity_fleet")


def fig4_storage_size(df: pd.DataFrame, out_dir: Path) -> None:
    """Reactive metrics against İzmir storage size; all are percentages against
    the same no-storage reference, so they share one axis."""
    sizes = at_baseline(df, except_for="storage_scale")
    rows = sizes[(sizes["scenario"] == "izmir-konak") & (sizes["strategy"] == "reactive")].copy()
    rows["storage_scale"] = rows["storage_scale"].astype(float)
    rows = rows.sort_values("storage_scale")
    # Label offsets: the 15-min line runs just above energy, so its labels go above
    # and energy's go below-right; instantaneous labels sit below its line.
    offsets = {"energy_saving_pct": (12, -11), "peak_15min_reduction_pct": (-6, 10), "peak_reduction_pct": (0, -13)}
    fig, ax = plt.subplots(figsize=(5.6, 3.4))
    for metric in METRICS:
        values = rows[metric["column"]].astype(float)
        ax.plot(rows["storage_scale"], values, color=metric["color"], marker=metric["marker"], markersize=6,
                linestyle=metric["linestyle"], linewidth=1.6, label=metric["label"])
        rolling = rows["peak_15min_reduction_pct"].astype(float)
        for x, value, rolling_value in zip(rows["storage_scale"], values, rolling):
            if x == 0:
                continue
            # Where energy and 15-min coincide at label precision, one label serves both.
            if metric["column"] == "energy_saving_pct" and f"{value:.1f}" == f"{rolling_value:.1f}":
                continue
            ax.annotate(f"{value:.1f}", (x, value), xytext=offsets[metric["column"]], textcoords="offset points",
                        ha="center", va="center", fontsize=8, color=INK)
    ax.set_xticks(rows["storage_scale"].tolist())
    ax.set_xticklabels([f"{x:g}×" for x in rows["storage_scale"]], fontsize=8.5)
    ax.set_xlim(-0.08, rows["storage_scale"].max() + 0.12)
    ax.set_ylim(0, rows[[m["column"] for m in METRICS]].astype(float).max().max() * 1.25)
    ax.set_xlabel("Flywheel storage, multiple of the configured banks", fontsize=9, color=INK)
    ax.set_ylabel("Change relative to no storage (%)", fontsize=9, color=INK)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, loc="upper left")
    fig.tight_layout()
    save(fig, out_dir, "fig4_storage_size")


def fig5_disturbance_recovery(series_path: Path, out_dir: Path, hold_minutes: int = 5) -> None:
    """Rolling mean absolute headway deviation around a hold, regulation on vs off."""
    data = json.loads(series_path.read_text())
    runs = {(item["kind"], item["holdMinutes"], item["mode"]): item for item in data["series"]}
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    for mode, style, label in (("on", ON_STYLE, "Regulation on"), ("off", OFF_STYLE, "Regulation off")):
        disturbed = runs[("hold", hold_minutes, mode)]
        reference = runs[("undisturbed", 0, mode)]
        start = disturbed["disturbanceAt"]
        for run, width, alpha, suffix, dash in ((reference, 1.0, 0.55, " (undisturbed)", ":"), (disturbed, 1.8, 1.0, f" ({hold_minutes}-min hold)", style["linestyle"])):
            points = [item for item in run["rolling"] if item["deviation"] is not None and item["time"] >= start - 600]
            ax.plot([(item["time"] - start) / 60 for item in points], [item["deviation"] for item in points],
                    color=style["color"], linewidth=width, alpha=alpha, linestyle=dash, label=label + suffix)
    ax.axvspan(0, hold_minutes, color=GRID, alpha=0.8, linewidth=0, zorder=0)
    ax.annotate("hold", (hold_minutes / 2, 1.0), xycoords=("data", "axes fraction"), xytext=(0, -10),
                textcoords="offset points", ha="center", fontsize=8, color=INK_SECONDARY)
    ax.set_xlabel("Minutes after the hold starts", fontsize=9, color=INK)
    ax.set_ylabel("Mean |headway − planned| (s),\n10-min rolling", fontsize=9, color=INK)
    ax.set_ylim(bottom=0)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=7.5, loc="upper left", bbox_to_anchor=(1.0, 1.0))
    fig.tight_layout()
    save(fig, out_dir, "fig5_disturbance_recovery")


def fig6_recovery_vs_size(csv_path: Path, out_dir: Path, horizon_minutes: float) -> None:
    """Recovery time against hold length; unrecovered runs are drawn at the horizon."""
    df = pd.read_csv(csv_path)
    holds = df[df["case"] == "hold"].copy()
    holds["hold_min"] = holds["hold_min"].astype(float)
    fig, ax = plt.subplots(figsize=(5.4, 3.3))
    for mode, style, label in (("on", ON_STYLE, "Regulation on"), ("off", OFF_STYLE, "Regulation off")):
        rows = holds[holds["mode"] == mode].sort_values("hold_min")
        recovered = rows["recovery_s"].notna()
        ys = (rows["recovery_s"].fillna(horizon_minutes * 60) / 60).tolist()
        ax.plot(rows["hold_min"], ys, color=style["color"], linestyle=style["linestyle"], linewidth=1.6, label=label)
        for x, y, ok in zip(rows["hold_min"], ys, recovered):
            ax.plot([x], [y], marker=style["marker"] if ok else "x", markersize=7, color=style["color"],
                    markerfacecolor=style["color"] if ok else "none", linestyle="none")
            # Recovered values below their marker (the re-sync line runs above); unrecovered above the horizon.
            ax.annotate(f"{y:.0f}" if ok else "not\nrecovered", (x, y), xytext=(0, -9 if ok else 7),
                        textcoords="offset points", ha="center", va="top" if ok else "bottom", fontsize=8, color=INK)
        if mode == "on":
            resync = rows["resync_s"] / 60
            ax.plot(rows["hold_min"], resync, color=style["color"], linestyle=":", linewidth=1.2, marker="o",
                    markersize=4, markerfacecolor="white", label="Regulation on, back on pattern (|ΔCV| ≤ 0.01)")
            for x, y in zip(rows["hold_min"], resync):
                ax.annotate(f"{y:.0f}", (x, y), xytext=(0, 5), textcoords="offset points", ha="center",
                            va="bottom", fontsize=7.5, color=INK_SECONDARY)
    ax.axhline(horizon_minutes, color=INK_SECONDARY, linewidth=0.8, linestyle=":")
    ax.annotate(f"horizon {horizon_minutes:.0f} min", (0.5, horizon_minutes), xycoords=("axes fraction", "data"),
                xytext=(0, -4), textcoords="offset points", ha="center", va="top", fontsize=8, color=INK_SECONDARY)
    ax.set_xticks(sorted(holds["hold_min"].unique()))
    ax.set_xlabel("Hold at Konak İskele (min)", fontsize=9, color=INK)
    ax.set_ylabel("Recovery time (min)", fontsize=9, color=INK)
    ax.set_ylim(0, horizon_minutes * 1.3)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=7.5, loc="lower right")
    fig.tight_layout()
    save(fig, out_dir, "fig6_recovery_vs_size")


def fig7_stopping_distance(csv_path: Path, out_dir: Path) -> None:
    df = pd.read_csv(csv_path)
    fig, ax = plt.subplots(figsize=(5.4, 3.3))
    for mode, style, label in (("service", ON_STYLE, "Service brake (1.25 m/s²)"), ("emergency", OFF_STYLE, "Emergency brake (2.4 m/s²)")):
        for load, fill in (("empty", True), ("full", False)):
            rows = df[(df["mode"] == mode) & (df["load"] == load)].sort_values("initial_speed_kmh")
            # Empty (filled) and full (open) coincide: the brakes reach the commanded
            # deceleration at either load, so only one legend entry per brake mode.
            ax.plot(rows["initial_speed_kmh"], rows["stopping_distance_m"], color=style["color"],
                    linestyle=style["linestyle"], linewidth=1.6 if fill else 0, marker=style["marker"],
                    markersize=6 if fill else 10, markerfacecolor=style["color"] if fill else "none",
                    label=label if fill else None)
            if fill:
                above = mode == "service"
                for x, y in zip(rows["initial_speed_kmh"], rows["stopping_distance_m"]):
                    first = x == rows["initial_speed_kmh"].min()
                    offset = ((-4, 14) if first else (-6, 8)) if above else (8, -2)
                    ax.annotate(f"{y:.0f} m", (x, y), xytext=offset, textcoords="offset points",
                                ha="left" if (first or not above) else "right", va="bottom" if above else "top",
                                fontsize=8, color=INK)
    ax.axvline(40, color=INK_SECONDARY, linewidth=0.8, linestyle=":")
    ax.annotate("line speed limit (40 km/h)", (40, 0.98), xycoords=("data", "axes fraction"), xytext=(4, 0),
                textcoords="offset points", va="top", fontsize=8, color=INK_SECONDARY)
    ax.set_xlim(16, 78)
    ax.set_xticks(sorted(df["initial_speed_kmh"].unique()))
    ax.set_xlabel("Initial speed (km/h)", fontsize=9, color=INK)
    ax.set_ylabel("Stopping distance (m)", fontsize=9, color=INK)
    ax.set_ylim(0, df["stopping_distance_m"].max() * 1.2)
    style_axes(ax)
    ax.legend(frameon=False, fontsize=7.5, loc="upper left", bbox_to_anchor=(0.0, 0.9))
    fig.tight_layout()
    save(fig, out_dir, "fig7_stopping_distance")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--series", type=Path, default=DEFAULT_SERIES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--automation", type=Path, default=DEFAULT_AUTOMATION,
                        help="directory with disturbance.csv, disturbance-series.json and braking.csv")
    args = parser.parse_args()

    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.fonttype": "none", "hatch.linewidth": 0.6})
    df = pd.read_csv(args.results, dtype={"tram_count_requested": str})
    if (df["core_runtime"] != "cpp-wasm").any():
        raise SystemExit("results.csv contains rows that did not run on the cpp-wasm core")
    fig1_savings_by_network(df, args.out)
    fig2_izmir_grid_power(pd.read_csv(args.series), df, args.out)
    fig3_sensitivity_fleet(df, args.out)
    fig4_storage_size(df, args.out)
    series = args.automation / "disturbance-series.json"
    if series.exists():
        horizon = json.loads(series.read_text())["horizonSeconds"] / 60
        fig5_disturbance_recovery(series, args.out)
        fig6_recovery_vs_size(args.automation / "disturbance.csv", args.out, horizon)
    else:
        print(f"skipped figures 5 and 6: {series} not found (npm run automation:disturbance)")
    braking = args.automation / "braking.csv"
    if braking.exists():
        fig7_stopping_distance(braking, args.out)
    else:
        print(f"skipped figure 7: {braking} not found (npm run automation:braking)")


if __name__ == "__main__":
    main()
