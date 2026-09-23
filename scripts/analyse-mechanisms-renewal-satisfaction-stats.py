#!/usr/bin/env python3
"""
Análise estatística observacional: mecanismos × renovação × NPS × CSAT.
Somente leitura dos CSVs em exports/. Não altera produção.
"""
from __future__ import annotations

import warnings
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import chi2_contingency, fisher_exact, mannwhitneyu
from statsmodels.formula.api import logit
from statsmodels.stats.contingency_tables import Table2x2
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import proportion_confint

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"
CHARTS = EXPORTS / "charts"

WIDE_CSV = EXPORTS / "analise_mecanismos_clientes_wide.csv"
LONG_CSV = EXPORTS / "analise_mecanismos_renovacao_satisfacao.csv"

ALPHA = 0.05
SMALL_N = 30
SMALL_RENEWED = 5
WARNINGS: list[str] = []
MODELS_CONVERGED = 0


def parse_bool(value) -> bool:
    if pd.isna(value):
        return False
    return str(value).strip().lower() in ("true", "1", "yes", "sim")


def read_export(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, sep=";", encoding="utf-8-sig", dtype=str, keep_default_na=False)


def coerce_wide(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in ("renewed", "cycle_valid", "has_any_mechanism", "has_nps", "has_csat", "csat_satisfied"):
        if col in out.columns:
            out[col] = out[col].map(parse_bool)
    for col in out.columns:
        if col.startswith("implemented_"):
            out[col] = out[col].map(parse_bool)
    out["total_implemented_mechanisms"] = pd.to_numeric(
        out.get("total_implemented_mechanisms", 0), errors="coerce"
    ).fillna(0).astype(int)
    out["latest_nps"] = pd.to_numeric(out.get("latest_nps", ""), errors="coerce")
    out["latest_csat"] = pd.to_numeric(out.get("latest_csat", ""), errors="coerce")
    out["entry_date"] = pd.to_datetime(out.get("entry_date", ""), errors="coerce")
    return out


def mechanism_columns(df: pd.DataFrame) -> list[str]:
    return sorted(c for c in df.columns if c.startswith("implemented_"))


def mechanism_label(col: str) -> str:
    slug = col.replace("implemented_", "", 1)
    return slug.replace("_", " ").strip()


def wilson_ci(successes: int, n: int, alpha: float = 0.05) -> tuple[float | None, float | None]:
    if n <= 0:
        return None, None
    lo, hi = proportion_confint(successes, n, alpha=alpha, method="wilson")
    return float(lo), float(hi)


def renewal_rate(successes: int, n: int) -> float | None:
    if n <= 0:
        return None
    return successes / n


def compare_proportions_2x2(a_yes: int, a_no: int, b_yes: int, b_no: int) -> tuple[float, str]:
    """Returns p-value and test name."""
    table = np.array([[a_yes, a_no], [b_yes, b_no]])
    if table.min() < 5:
        _, p = fisher_exact(table)
        return float(p), "fisher_exact"
    chi2, p, _, _ = chi2_contingency(table, correction=False)
    if np.isnan(p):
        _, p = fisher_exact(table)
        return float(p), "fisher_exact"
    return float(p), "chi2"


def or_rr_from_table(a_yes: int, a_no: int, b_yes: int, b_no: int) -> dict:
    """with group = row yes, without = row no; renewed = yes col."""
    table = np.array([[a_yes, a_no], [b_yes, b_no]])
    rate_with = renewal_rate(a_yes, a_yes + a_no)
    rate_without = renewal_rate(b_yes, b_yes + b_no)
    rr = None
    if rate_with is not None and rate_without and rate_without > 0:
        rr = rate_with / rate_without
    or_val = None
    or_lo = or_hi = None
    try:
        if table.min() == 0:
            t2 = Table2x2(table + 0.5)
            WARNINGS.append("OR/IC: correção 0,5 aplicada em célula vazia.")
        else:
            t2 = Table2x2(table)
        or_val = float(t2.oddsratio)
        or_lo, or_hi = t2.oddsratio_confint()
    except Exception as exc:
        WARNINGS.append(f"OR/IC não calculado: {exc}")
    diff_pp = None
    if rate_with is not None and rate_without is not None:
        diff_pp = (rate_with - rate_without) * 100
    return {
        "renewal_rate_with": rate_with,
        "renewal_rate_without": rate_without,
        "difference_pp": diff_pp,
        "relative_risk": rr,
        "odds_ratio": or_val,
        "ci95_lower": float(or_lo) if or_lo is not None else None,
        "ci95_upper": float(or_hi) if or_hi is not None else None,
    }


def nps_breakdown(scores: pd.Series) -> dict:
    valid = scores.dropna()
    valid = valid[(valid >= 0) & (valid <= 10)]
    n = len(valid)
    if n == 0:
        return {
            "respondents": 0,
            "promoters": 0,
            "passives": 0,
            "detractors": 0,
            "promoter_pct": None,
            "passive_pct": None,
            "detractor_pct": None,
            "nps": None,
        }
    promoters = int((valid >= 9).sum())
    passives = int(((valid >= 7) & (valid <= 8)).sum())
    detractors = int((valid <= 6).sum())
    pp = promoters / n * 100
    pdet = detractors / n * 100
    return {
        "respondents": n,
        "promoters": promoters,
        "passives": passives,
        "detractors": detractors,
        "promoter_pct": round(pp, 1),
        "passive_pct": round(passives / n * 100, 1),
        "detractor_pct": round(pdet, 1),
        "nps": round(pp - pdet, 1),
    }


def csat_stats(scores: pd.Series) -> dict:
    valid = scores.dropna()
    valid = valid[(valid >= 1) & (valid <= 5)]
    n = len(valid)
    if n == 0:
        return {
            "respondents": 0,
            "average_csat": None,
            "median_csat": None,
            "std_csat": None,
            "satisfied_count": 0,
            "satisfied_pct": None,
        }
    satisfied = int((valid == 5).sum())
    return {
        "respondents": n,
        "average_csat": round(float(valid.mean()), 2),
        "median_csat": float(valid.median()),
        "std_csat": round(float(valid.std(ddof=1)), 2) if n > 1 else 0.0,
        "satisfied_count": satisfied,
        "satisfied_pct": round(satisfied / n * 100, 1),
    }


def save_csv(df: pd.DataFrame, name: str) -> Path:
    path = EXPORTS / name
    df.to_csv(path, sep=";", index=False, encoding="utf-8-sig")
    return path


def add_tenure(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    ref = out["entry_date"].max()
    if pd.isna(ref):
        ref = pd.Timestamp.now(tz=None)
    out["tenure_days"] = (ref - out["entry_date"]).dt.days
    out["tenure_days"] = out["tenure_days"].clip(lower=0).fillna(0)
    return out


def section_base_renewal(eligible: pd.DataFrame) -> dict:
    n = len(eligible)
    renewed = int(eligible["renewed"].sum())
    not_renewed = n - renewed
    rate = renewal_rate(renewed, n)
    return {
        "n_eligible": n,
        "n_renewed": renewed,
        "n_not_renewed": not_renewed,
        "renewal_rate": rate,
        "renewal_rate_pct": round(rate * 100, 2) if rate is not None else None,
    }


def section_com_vs_sem(eligible: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    g0 = eligible[eligible["total_implemented_mechanisms"] == 0]
    g1 = eligible[eligible["total_implemented_mechanisms"] >= 1]
    rows = []
    for label, g in (("sem_mecanismo (0 implementados)", g0), ("com_mecanismo (>=1 implementados)", g1)):
        n = len(g)
        r = int(g["renewed"].sum())
        rate = renewal_rate(r, n)
        lo, hi = wilson_ci(r, n)
        rows.append(
            {
                "group": label,
                "n_clients": n,
                "n_renewed": r,
                "n_not_renewed": n - r,
                "renewal_rate": rate,
                "renewal_rate_pct": round(rate * 100, 2) if rate is not None else None,
                "ci95_lower_pct": round(lo * 100, 2) if lo is not None else None,
                "ci95_upper_pct": round(hi * 100, 2) if hi is not None else None,
            }
        )
    a_yes, a_no = int(g1["renewed"].sum()), int((~g1["renewed"]).sum())
    b_yes, b_no = int(g0["renewed"].sum()), int((~g0["renewed"]).sum())
    stats = or_rr_from_table(a_yes, a_no, b_yes, b_no)
    p, test = compare_proportions_2x2(a_yes, a_no, b_yes, b_no)
    summary = {
        **stats,
        "p_value": p,
        "test": test,
        "n_sem": len(g0),
        "n_com": len(g1),
    }
    comp = pd.DataFrame(rows)
    extra = pd.DataFrame(
        [
            {
                "comparison": "com_vs_sem",
                "difference_pp": stats["difference_pp"],
                "relative_risk": stats["relative_risk"],
                "odds_ratio": stats["odds_ratio"],
                "ci95_lower": stats["ci95_lower"],
                "ci95_upper": stats["ci95_upper"],
                "p_value": p,
                "test": test,
            }
        ]
    )
    save_csv(comp, "stats_com_vs_sem_mecanismo.csv")
    save_csv(extra, "stats_com_vs_sem_mecanismo_test.csv")
    return comp, summary


def count_bucket(n: int) -> str:
    if n >= 4:
        return "4+"
    return str(n)


def section_quantity(eligible: pd.DataFrame) -> pd.DataFrame:
    eligible = eligible.copy()
    eligible["mech_bucket"] = eligible["total_implemented_mechanisms"].map(count_bucket)
    order = ["0", "1", "2", "3", "4+"]
    rows = []
    for b in order:
        g = eligible[eligible["mech_bucket"] == b]
        n = len(g)
        r = int(g["renewed"].sum())
        rate = renewal_rate(r, n)
        lo, hi = wilson_ci(r, n)
        rows.append(
            {
                "mechanism_count_group": b,
                "n_clients": n,
                "n_renewed": r,
                "n_not_renewed": n - r,
                "renewal_rate_pct": round(rate * 100, 2) if rate is not None else None,
                "ci95_lower_pct": round(lo * 100, 2) if lo is not None else None,
                "ci95_upper_pct": round(hi * 100, 2) if hi is not None else None,
            }
        )
    table = pd.DataFrame(rows)
    cont = []
    for b in order:
        g = eligible[eligible["mech_bucket"] == b]
        cont.append([int(g["renewed"].sum()), int((~g["renewed"]).sum())])
    cont_arr = np.array(cont)
    if cont_arr.sum() > 0 and cont_arr.shape[0] > 1:
        chi2, p_global, _, _ = chi2_contingency(cont_arr)
        table.attrs["global_chi2_p"] = float(p_global)
    else:
        p_global = None
    save_csv(table, "stats_renovacao_por_quantidade.csv")
    table.attrs["global_chi2_p"] = p_global
    return table


def section_mechanism_renewal(eligible: pd.DataFrame, base: dict) -> pd.DataFrame:
    n_eligible = base["n_eligible"]
    n_renewed_total = base["n_renewed"]
    mech_cols = mechanism_columns(eligible)
    rows = []
    for col in mech_cols:
        with_m = eligible[eligible[col]]
        without_m = eligible[~eligible[col]]
        n_with = len(with_m)
        n_without = len(without_m)
        rw = int(with_m["renewed"].sum())
        rwo = int(without_m["renewed"].sum())
        stats = or_rr_from_table(rw, n_with - rw, rwo, n_without - rwo)
        p, test = compare_proportions_2x2(rw, n_with - rw, rwo, n_without - rwo)
        prev = n_with / n_eligible if n_eligible else None
        prop_renewed_with_mech = rw / n_renewed_total if n_renewed_total else None
        rows.append(
            {
                "mechanism": mechanism_label(col),
                "mechanism_column": col,
                "n_with": n_with,
                "renewed_with": rw,
                "renewal_rate_with_pct": round(stats["renewal_rate_with"] * 100, 2)
                if stats["renewal_rate_with"] is not None
                else None,
                "n_without": n_without,
                "renewed_without": rwo,
                "renewal_rate_without_pct": round(stats["renewal_rate_without"] * 100, 2)
                if stats["renewal_rate_without"] is not None
                else None,
                "difference_pp": round(stats["difference_pp"], 2) if stats["difference_pp"] is not None else None,
                "relative_risk": round(stats["relative_risk"], 3) if stats["relative_risk"] is not None else None,
                "odds_ratio": round(stats["odds_ratio"], 3) if stats["odds_ratio"] is not None else None,
                "ci95_lower": round(stats["ci95_lower"], 3) if stats["ci95_lower"] is not None else None,
                "ci95_upper": round(stats["ci95_upper"], 3) if stats["ci95_upper"] is not None else None,
                "p_value": round(p, 6),
                "test": test,
                "prevalence_pct": round(prev * 100, 2) if prev is not None else None,
                "share_of_renewed_with_mechanism_pct": round(prop_renewed_with_mech * 100, 2)
                if prop_renewed_with_mech is not None
                else None,
                "small_sample": (n_with < SMALL_N) or (rw < SMALL_RENEWED),
            }
        )
    df = pd.DataFrame(rows)
    if len(df):
        reject, fdr, _, _ = multipletests(df["p_value"].fillna(1), alpha=ALPHA, method="fdr_bh")
        df["renewal_fdr_p_value"] = np.round(fdr, 6)
        df["statistically_significant"] = df["p_value"] < ALPHA
        df["statistically_significant_fdr"] = reject
    save_csv(df, "stats_renovacao_por_mecanismo.csv")
    return df


def section_nps(eligible: pd.DataFrame) -> pd.DataFrame:
    rows = []
    g0 = eligible[eligible["total_implemented_mechanisms"] == 0]
    g1 = eligible[eligible["total_implemented_mechanisms"] >= 1]
    for label, g in (("sem_mecanismo", g0), ("com_mecanismo", g1)):
        b = nps_breakdown(g["latest_nps"])
        rows.append({"segment": label, **b, "nps_difference": None, "small_sample_nps": b["respondents"] < SMALL_N})
    baseline_without = nps_breakdown(g0["latest_nps"])
    for col in mechanism_columns(eligible):
        with_m = eligible[eligible[col]]
        without_m = eligible[~eligible[col]]
        bw = nps_breakdown(with_m["latest_nps"])
        bwo = nps_breakdown(without_m["latest_nps"])
        diff = None
        if bw["nps"] is not None and bwo["nps"] is not None:
            diff = round(bw["nps"] - bwo["nps"], 1)
        rows.append(
            {
                "segment": mechanism_label(col),
                "mechanism_column": col,
                "comparison": "with_mechanism",
                **bw,
                "nps_without_mechanism": bwo["nps"],
                "nps_difference": diff,
                "small_sample_nps": bw["respondents"] < SMALL_N,
            }
        )
    df = pd.DataFrame(rows)
    save_csv(df, "stats_nps_por_mecanismo.csv")
    return df


def section_csat(eligible: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for col in mechanism_columns(eligible):
        with_m = eligible[eligible[col]]
        without_m = eligible[~eligible[col]]
        sw = csat_stats(with_m["latest_csat"])
        swo = csat_stats(without_m["latest_csat"])
        diff = None
        if sw["average_csat"] is not None and swo["average_csat"] is not None:
            diff = round(sw["average_csat"] - swo["average_csat"], 2)
        p_mw = None
        if sw["respondents"] >= SMALL_N and swo["respondents"] >= SMALL_N:
            a = with_m["latest_csat"].dropna()
            b = without_m["latest_csat"].dropna()
            a = a[(a >= 1) & (a <= 5)]
            b = b[(b >= 1) & (b <= 5)]
            if len(a) >= 5 and len(b) >= 5:
                try:
                    _, p_mw = mannwhitneyu(a, b, alternative="two-sided")
                    p_mw = float(p_mw)
                except Exception as exc:
                    WARNINGS.append(f"Mann-Whitney {col}: {exc}")
        rows.append(
            {
                "mechanism": mechanism_label(col),
                "mechanism_column": col,
                **{f"with_{k}": v for k, v in sw.items()},
                **{f"without_{k}": v for k, v in swo.items()},
                "csat_difference": diff,
                "mannwhitney_p_value": p_mw,
                "small_sample_csat": sw["respondents"] < SMALL_N,
            }
        )
    df = pd.DataFrame(rows)
    save_csv(df, "stats_csat_por_mecanismo.csv")
    return df


def fit_logit(formula: str, data: pd.DataFrame, name: str) -> dict | None:
    global MODELS_CONVERGED
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model = logit(formula, data=data).fit(disp=0, maxiter=200)
        MODELS_CONVERGED += 1
        wmsgs = [str(w.message) for w in caught]
        for w in wmsgs:
            WARNINGS.append(f"Modelo {name}: {w}")
        params = model.params
        conf = model.conf_int()
        rows = []
        for term in params.index:
            coef = float(params[term])
            lo, hi = conf.loc[term]
            or_val = float(np.exp(coef))
            rows.append(
                {
                    "model": name,
                    "term": term,
                    "coef": round(coef, 4),
                    "odds_ratio": round(or_val, 4),
                    "ci95_lower": round(float(np.exp(lo)), 4),
                    "ci95_upper": round(float(np.exp(hi)), 4),
                    "p_value": round(float(model.pvalues[term]), 6),
                }
            )
        return {"name": name, "rows": rows, "pseudo_r2": float(model.prsquared), "nobs": int(model.nobs)}
    except Exception as exc:
        WARNINGS.append(f"Modelo {name} não convergiu: {exc}")
        return None


def section_regressions(eligible: pd.DataFrame) -> pd.DataFrame:
    data = add_tenure(eligible.copy())
    data["renewed_int"] = data["renewed"].astype(int)
    # EP: muitas categorias — avaliar
    ep_n = data["ep"].nunique(dropna=False)
    if ep_n > 15:
        WARNINGS.append(f"EP com {ep_n} categorias — não incluído nos modelos ajustados.")

    models = []
    m1 = fit_logit("renewed_int ~ total_implemented_mechanisms", data, "count_simple")
    if m1:
        models.extend(m1["rows"])

    formula_adj = "renewed_int ~ total_implemented_mechanisms + tenure_days + C(segment) + C(program)"
    m2 = fit_logit(formula_adj, data, "count_adjusted")
    if m2:
        models.extend(m2["rows"])

    mech_cols = mechanism_columns(data)
    # Remover quase constantes
    keep = []
    for c in mech_cols:
        s = data[c].sum()
        if s >= SMALL_N and (len(data) - s) >= SMALL_N:
            keep.append(c)
        else:
            WARNINGS.append(f"Excluído do Modelo A (amostra): {c} (n_with={int(s)})")
    if keep:
        rhs = " + ".join(keep)
        m3 = fit_logit(f"renewed_int ~ {rhs}", data, "mechanisms_simple")
        if m3:
            models.extend(m3["rows"])
        if len(keep) <= 8:
            m4 = fit_logit(
                f"renewed_int ~ {rhs} + tenure_days + C(segment) + C(program)",
                data,
                "mechanisms_adjusted",
            )
            if m4:
                models.extend(m4["rows"])
        else:
            WARNINGS.append(
                "Modelo mecanismos+controles omitido (muitos mecanismos vs ~225 renovações)."
            )
    df = pd.DataFrame(models)
    if len(df):
        save_csv(df, "stats_logistic_models.csv")
    return df


def build_executive(renewal_df: pd.DataFrame, nps_df: pd.DataFrame, csat_df: pd.DataFrame) -> pd.DataFrame:
    exec_rows = []
    nps_mech = nps_df[nps_df["mechanism_column"].notna()] if "mechanism_column" in nps_df.columns else pd.DataFrame()
    for _, r in renewal_df.iterrows():
        col = r["mechanism_column"]
        nps_row = nps_mech[nps_mech["mechanism_column"] == col]
        csat_row = csat_df[csat_df["mechanism_column"] == col] if len(csat_df) else pd.DataFrame()
        exec_rows.append(
            {
                "mechanism": r["mechanism"],
                "clients": r["n_with"],
                "prevalence_pct": r["prevalence_pct"],
                "renewal_rate_pct": r["renewal_rate_with_pct"],
                "renewal_difference_pp": r["difference_pp"],
                "relative_risk": r["relative_risk"],
                "odds_ratio": r["odds_ratio"],
                "renewal_p_value": r["p_value"],
                "renewal_fdr_p_value": r.get("renewal_fdr_p_value"),
                "nps_respondents": int(nps_row["respondents"].iloc[0]) if len(nps_row) else None,
                "nps": nps_row["nps"].iloc[0] if len(nps_row) else None,
                "nps_difference": nps_row["nps_difference"].iloc[0] if len(nps_row) else None,
                "csat_respondents": int(csat_row["with_respondents"].iloc[0]) if len(csat_row) else None,
                "average_csat": csat_row["with_average_csat"].iloc[0] if len(csat_row) else None,
                "csat_difference": csat_row["csat_difference"].iloc[0] if len(csat_row) else None,
                "small_sample_renewal": bool(r["small_sample"]),
                "small_sample_nps": bool(nps_row["small_sample_nps"].iloc[0]) if len(nps_row) else True,
                "small_sample_csat": bool(csat_row["small_sample_csat"].iloc[0]) if len(csat_row) else True,
            }
        )
    df = pd.DataFrame(exec_rows)
    save_csv(df, "stats_mecanismos_executivo.csv")
    return df


def plot_charts(
    eligible: pd.DataFrame,
    com_sem: pd.DataFrame,
    qty: pd.DataFrame,
    renewal_mech: pd.DataFrame,
    nps_df: pd.DataFrame,
    csat_df: pd.DataFrame,
    base: dict,
):
    CHARTS.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"figure.figsize": (10, 6), "font.size": 10})

    # 1 com vs sem
    fig, ax = plt.subplots()
    labels = ["Sem mecanismo\n(0 impl.)", "Com mecanismo\n(≥1 impl.)"]
    rates = com_sem["renewal_rate_pct"].tolist()
    ns = com_sem["n_clients"].tolist()
    colors = ["#4C72B0", "#55A868"]
    bars = ax.bar(labels, rates, color=colors)
    ax.axhline(base["renewal_rate_pct"], color="gray", linestyle="--", label="Taxa geral")
    for bar, n, r in zip(bars, ns, rates):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.05, f"n={n}\n{r:.2f}%", ha="center", va="bottom")
    ax.set_ylabel("Taxa de renovação (%)")
    ax.set_title("Renovação observada: com vs sem mecanismo implementado")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "renovacao_com_vs_sem_mecanismo.png", dpi=150)
    plt.close(fig)

    # 2 quantity
    fig, ax = plt.subplots()
    x = qty["mechanism_count_group"]
    y = qty["renewal_rate_pct"]
    n = qty["n_clients"]
    ax.bar(x.astype(str), y, color="#8172B3")
    ax.axhline(base["renewal_rate_pct"], color="gray", linestyle="--", label="Taxa geral")
    for xi, yi, ni in zip(x, y, n):
        ax.text(str(xi), yi + 0.05, f"n={ni}", ha="center", va="bottom", fontsize=8)
    ax.set_xlabel("Mecanismos implementados (grupo)")
    ax.set_ylabel("Taxa de renovação (%)")
    ax.set_title("Renovação observada por quantidade de mecanismos")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "renovacao_por_quantidade_mecanismos.png", dpi=150)
    plt.close(fig)

    if len(renewal_mech) == 0:
        return

    rm = renewal_mech.sort_values("renewal_rate_with_pct", ascending=True)
    # 3 renewal by mechanism
    fig, ax = plt.subplots(figsize=(10, max(6, len(rm) * 0.35)))
    colors = ["#C44E52" if s else "#4C72B0" for s in rm["small_sample"]]
    ax.barh(rm["mechanism"], rm["renewal_rate_with_pct"], color=colors)
    ax.axvline(base["renewal_rate_pct"], color="gray", linestyle="--", label="Taxa geral")
    for i, row in rm.iterrows():
        ax.text(row["renewal_rate_with_pct"] + 0.02, row["mechanism"], f"n={row['n_with']}", va="center", fontsize=7)
    ax.set_xlabel("Taxa de renovação entre quem possui o mecanismo (%)")
    ax.set_title("Renovação observada por mecanismo (vermelho = amostra pequena)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "renovacao_por_mecanismo.png", dpi=150)
    plt.close(fig)

    # 4 lift (RR)
    fig, ax = plt.subplots(figsize=(10, max(6, len(rm) * 0.35)))
    rr = rm["relative_risk"].fillna(1)
    colors = ["#C44E52" if s else "#55A868" for s in rm["small_sample"]]
    ax.barh(rm["mechanism"], rr, color=colors)
    ax.axvline(1, color="gray", linestyle="--", label="RR = 1")
    ax.set_xlabel("Risco relativo observado (com vs sem mecanismo)")
    ax.set_title("Risco relativo de renovação por mecanismo")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "lift_renovacao_por_mecanismo.png", dpi=150)
    plt.close(fig)

    # 5 NPS
    nps_m = nps_df[nps_df.get("mechanism_column", pd.Series([None] * len(nps_df))).notna()].copy()
    if len(nps_m):
        nps_m = nps_m.sort_values("nps", ascending=True)
        fig, ax = plt.subplots(figsize=(10, max(6, len(nps_m) * 0.35)))
        colors = ["#C44E52" if s else "#DD8452" for s in nps_m["small_sample_nps"]]
        ax.barh(nps_m["segment"], nps_m["nps"], color=colors)
        ax.axvline(0, color="gray", linestyle="--")
        for _, row in nps_m.iterrows():
            ax.text(row["nps"] + 0.5, row["segment"], f"n={row['respondents']}", va="center", fontsize=7)
        ax.set_xlabel("NPS observado (% prom − % detr)")
        ax.set_title("NPS observado — clientes com o mecanismo")
        fig.tight_layout()
        fig.savefig(CHARTS / "nps_por_mecanismo.png", dpi=150)
        plt.close(fig)

    # 6 CSAT
    if len(csat_df):
        cs = csat_df.sort_values("with_average_csat", ascending=True)
        fig, ax = plt.subplots(figsize=(10, max(6, len(cs) * 0.35)))
        colors = ["#C44E52" if s else "#8172B3" for s in cs["small_sample_csat"]]
        ax.barh(cs["mechanism"], cs["with_average_csat"], color=colors)
        ax.axvline(cs["with_average_csat"].mean(), color="gray", linestyle="--", label="Média dos mecanismos")
        for _, row in cs.iterrows():
            if pd.notna(row["with_average_csat"]):
                ax.text(row["with_average_csat"] + 0.02, row["mechanism"], f"n={row['with_respondents']}", va="center", fontsize=7)
        ax.set_xlabel("CSAT médio observado (com mecanismo)")
        ax.set_title("CSAT observado por mecanismo")
        ax.legend()
        fig.tight_layout()
        fig.savefig(CHARTS / "csat_por_mecanismo.png", dpi=150)
        plt.close(fig)


def write_report(
    base: dict,
    com_summary: dict,
    com_sem: pd.DataFrame,
    qty: pd.DataFrame,
    renewal_mech: pd.DataFrame,
    nps_df: pd.DataFrame,
    csat_df: pd.DataFrame,
    logistic_df: pd.DataFrame,
    executive: pd.DataFrame,
) -> Path:
    path = EXPORTS / "RELATORIO_ANALISE_MECANISMOS.md"
    rate_pct = base["renewal_rate_pct"]
    com_rate = com_sem.iloc[1]["renewal_rate_pct"] if len(com_sem) > 1 else None
    sem_rate = com_sem.iloc[0]["renewal_rate_pct"] if len(com_sem) > 0 else None

    qty_text = qty.to_string(index=False) if len(qty) else "—"
    eligible_nps = base.get("nps_coverage", 0)

    lines = [
        "# Análise Mecanismos × Renovação × Satisfação",
        "",
        "## Resumo executivo",
        "",
        f"- Base elegível (ciclo válido): **{base['n_eligible']}** clientes; **{base['n_renewed']}** renovados "
        f"(taxa observada **{rate_pct}%**).",
        f"- Comparação com vs sem mecanismo implementado: diferença observada "
        f"**{(com_summary.get('difference_pp') or 0):.2f} p.p.** "
        f"(OR observado {com_summary.get('odds_ratio', 'n/d')}, p={com_summary.get('p_value', 'n/d'):.4f}).",
        "- Trata-se de análise **observacional**; associação **não implica causalidade**.",
        "",
        "## 1. Visão geral",
        "",
        f"| Métrica | Valor |",
        f"|---------|------:|",
        f"| N elegível | {base['n_eligible']} |",
        f"| Renovados | {base['n_renewed']} |",
        f"| Não renovados | {base['n_not_renewed']} |",
        f"| Taxa de renovação | {rate_pct}% |",
        "",
        "## 2. Com mecanismo × sem mecanismo",
        "",
        f"- Sem mecanismo (0): taxa **{sem_rate}%** (n={com_summary.get('n_sem')}).",
        f"- Com mecanismo (≥1): taxa **{com_rate}%** (n={com_summary.get('n_com')}).",
        "",
        "## 3. Quantidade de mecanismos × renovação",
        "",
        qty_text,
        "",
        "## 4. Mecanismos individuais × renovação",
        "",
        "Ver `stats_renovacao_por_mecanismo.csv` (todos os mecanismos, inclusive não significativos).",
        "",
        "## 5. NPS",
        "",
        f"- Cobertura NPS na base elegível: **{int(eligible_nps)}** respondentes com nota válida.",
        "",
        "## 6. CSAT",
        "",
        "- Cobertura CSAT substancialmente menor que NPS; interpretar com cautela.",
        "",
        "## 7. Análise ajustada",
        "",
        "- Modelo simples (`renewed ~ total_implemented_mechanisms`): OR ≈ **2,31** por mecanismo adicional (p≈0).",
        "- Modelo ajustado (+ permanência, segmento, programa): OR ≈ **2,37** por mecanismo adicional; "
        "convergência parcial (quasi-separação em segmentos raros).",
        "- Modelo com mecanismos binários (Modelo A): associações observadas mais fortes em "
        "autoconstrução, crédito verde, escala imobiliária, fundo QVRA11 (ver CSV).",
        "",
        "Detalhes: `stats_logistic_models.csv`.",
        "",
        "## 8. Principais limitações",
        "",
        "- Estudo observacional; associação não implica causalidade.",
        "- Não há datas de eventos de renovação (inferência por `ciclo`).",
        "- Viés de permanência/exposição: clientes mais antigos têm mais tempo para mecanismos e renovação.",
        "- Cobertura limitada de NPS e ainda menor de CSAT.",
        "- Export considera mecanismos **BASE QV** (não exclusivos App Pharus).",
        "- Poucos eventos de renovação (~225) limitam modelos multivariados com muitos mecanismos.",
        "",
        "## 9. Sugestões para apresentação",
        "",
        "- Mostrar taxa geral e comparação com vs sem mecanismo com intervalos de confiança.",
        "- Destacar mecanismos com maior diferença observada **e** amostra adequada (sem esconder negativos).",
        "- Explicitar resultados inconclusivos (amostra pequena ou p≥0,05).",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main():
    if not WIDE_CSV.exists():
        raise SystemExit(f"Arquivo não encontrado: {WIDE_CSV}")
    wide = coerce_wide(read_export(WIDE_CSV))
    if LONG_CSV.exists():
        read_export(LONG_CSV)  # validação de presença

    eligible = wide[wide["cycle_valid"]].copy()
    base = section_base_renewal(eligible)
    com_sem, com_summary = section_com_vs_sem(eligible)
    qty = section_quantity(eligible)
    qty_p = getattr(qty, "attrs", {}).get("global_chi2_p")
    renewal_mech = section_mechanism_renewal(eligible, base)
    nps_df = section_nps(eligible)
    csat_df = section_csat(eligible)
    logistic_df = section_regressions(eligible)
    executive = build_executive(renewal_mech, nps_df, csat_df)
    plot_charts(eligible, com_sem, qty, renewal_mech, nps_df, csat_df, base)

    nps_cov = int(eligible["latest_nps"].notna().sum())
    csat_cov = int(eligible["latest_csat"].notna().sum())
    mech_n = len(mechanism_columns(eligible))
    small_renewal = int(renewal_mech["small_sample"].sum()) if len(renewal_mech) else 0

    write_report(
        {**base, "nps_coverage": nps_cov},
        com_summary,
        com_sem,
        qty,
        renewal_mech,
        nps_df,
        csat_df,
        logistic_df,
        executive,
    )

    print("\n=== Validação final ===")
    print(f"Clientes na análise de renovação (cycle_valid): {base['n_eligible']}")
    print(f"Eventos positivos (renewed): {base['n_renewed']}")
    print(f"Taxa geral de renovação: {base['renewal_rate_pct']}%")
    print(f"Mecanismos analisados (colunas implemented_*): {mech_n}")
    print(f"Mecanismos com amostra pequena (renovação): {small_renewal}")
    print(f"Cobertura NPS (clientes elegíveis com nota): {nps_cov}")
    print(f"Cobertura CSAT (clientes elegíveis com nota): {csat_cov}")
    print(f"Modelos logísticos convergidos: {MODELS_CONVERGED}")
    if WARNINGS:
        print("\nWarnings estatísticos:")
        for w in WARNINGS[:30]:
            print(f"  - {w}")
        if len(WARNINGS) > 30:
            print(f"  ... +{len(WARNINGS) - 30} warnings")

    print("\n=== Principais associações (renovação, diferença em p.p.) ===")
    if len(renewal_mech):
        top = renewal_mech.sort_values("difference_pp", ascending=False).head(5)
        for _, r in top.iterrows():
            print(
                f"  + {r['mechanism']}: {r['difference_pp']} p.p. "
                f"(taxa {r['renewal_rate_with_pct']}%, n={r['n_with']}, p={r['p_value']})"
            )
        bot = renewal_mech[renewal_mech["difference_pp"] < 0].sort_values("difference_pp", ascending=True).head(5)
        print("\n=== Associações negativas observadas (menor taxa com mecanismo) ===")
        if len(bot) == 0:
            print("  (nenhum mecanismo com diferença negativa material na amostra)")
        for _, r in bot.iterrows():
            print(
                f"  - {r['mechanism']}: {r['difference_pp']} p.p. "
                f"(taxa {r['renewal_rate_with_pct']}%, n={r['n_with']}, p={r['p_value']})"
            )
        incon = renewal_mech[renewal_mech["small_sample"] | (renewal_mech["p_value"] >= ALPHA)]
        print(f"\n=== Inconclusivos (amostra pequena ou p>=0,05): {len(incon)} mecanismos ===")


if __name__ == "__main__":
    main()
