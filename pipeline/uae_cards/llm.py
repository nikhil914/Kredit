"""LLM post-processing: page Markdown (+ optional rule-based draft) -> strict record.

Uses Claude structured outputs (`output_config.format` with a JSON schema generated from
the Pydantic models), then re-validates with Pydantic so the business rules in
schema.py (slug id, FFL => fee 0, percent ranges, max 5 benefits) still apply.

Requires `pip install 'uae-cards[llm]'` and an Anthropic credential (ANTHROPIC_API_KEY
or `ant auth login`).
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ValidationError

from .schema import CreditCard, HiddenSpendCriterion, SiteExtras, _Strict

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "card_extraction.md"
DEFAULT_MODEL = "claude-opus-5-5"


class InferredField(_Strict):
    field: str
    reason: str


class FieldEvidence(_Strict):
    field: str
    quote: str


class LLMEnvelope(_Strict):
    out_of_scope: bool
    card: CreditCard
    hidden_spend_criteria: list[HiddenSpendCriterion]
    site_extras: SiteExtras
    inferred_fields: list[InferredField]
    evidence: list[FieldEvidence]
    warnings: list[str]


_UNSUPPORTED = {"default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
                "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems"}


def output_schema(model: type[BaseModel] = LLMEnvelope) -> dict:
    """Pydantic schema -> structured-output schema: every object closed, every key required
    (nullable fields stay nullable via anyOf null), unsupported constraints stripped."""
    schema = copy.deepcopy(model.model_json_schema())

    def fix(node):
        if isinstance(node, dict):
            for k in list(node):
                if k in _UNSUPPORTED:
                    node.pop(k)
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node["properties"].keys())
            for v in node.values():
                fix(v)
        elif isinstance(node, list):
            for v in node:
                fix(v)

    fix(schema)
    return schema


def system_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def user_message(url: str, page_markdown: str, draft: Optional[dict] = None) -> str:
    parts = [f"<page_url>{url}</page_url>"]
    if draft:
        parts.append("<draft_record>\n" + json.dumps(draft, ensure_ascii=False, indent=1) + "\n</draft_record>")
    parts.append("<page_content>\n" + page_markdown + "\n</page_content>")
    parts.append("Normalize this card page into the response schema and list every hidden spend criterion.")
    return "\n\n".join(parts)


@dataclass
class LLMResult:
    envelope: Optional[LLMEnvelope]
    raw: Optional[dict] = None
    error: Optional[str] = None
    stop_reason: Optional[str] = None
    usage: dict = field(default_factory=dict)


def extract_with_claude(
    url: str,
    page_markdown: str,
    *,
    draft: Optional[dict] = None,
    client=None,
    model: str = DEFAULT_MODEL,
    effort: str = "medium",
) -> LLMResult:
    import anthropic

    client = client or anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=model,
        max_tokens=16000,
        system=[{"type": "text", "text": system_prompt(), "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_message(url, page_markdown, draft)}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": output_schema()}},
        # Server-side fallback if a safety classifier declines (re-runs on a fallback model).
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    usage = resp.usage.model_dump() if getattr(resp, "usage", None) else {}
    if resp.stop_reason == "refusal":
        return LLMResult(None, error="model declined the request", stop_reason="refusal", usage=usage)
    if resp.stop_reason == "max_tokens":
        return LLMResult(None, error="output truncated (max_tokens)", stop_reason="max_tokens", usage=usage)
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if text is None:
        return LLMResult(None, error="no text block in response", stop_reason=resp.stop_reason, usage=usage)
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        return LLMResult(None, error=f"invalid JSON: {e}", stop_reason=resp.stop_reason, usage=usage)
    try:
        env = LLMEnvelope.model_validate(raw)
    except ValidationError as e:
        # Schema-valid but violates a business rule (e.g. FFL with a fee). Surface for review.
        return LLMResult(None, raw=raw, error=f"validation: {e}", stop_reason=resp.stop_reason, usage=usage)
    for c in env.hidden_spend_criteria:
        if not c.source_url:
            c.source_url = url
    return LLMResult(env, raw=raw, stop_reason=resp.stop_reason, usage=usage)
