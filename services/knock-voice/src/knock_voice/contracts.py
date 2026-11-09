import math

LABELS = {
    "Review": "합성 의심",
    "Pass": "뚜렷한 합성 신호 없음",
    "Unable": "판단 보류",
}


def outcome(score=None, reason=None, *, threshold=0.5):
    if reason is None and (score is None or not math.isfinite(score) or not 0 <= score <= 1):
        reason = "invalid_model_score"
    decision = "Unable" if reason else "Review" if score >= threshold else "Pass"
    return {"decision": decision, "label": LABELS[decision], "reason": reason}


def ui_view(result):
    """Legacy helper retained with the current strict public boundary."""
    label = result.get("label")
    if label not in ("pass", "review", "unable"):
        label = "unable"
    return {"label": label, "at": result["at"]}
