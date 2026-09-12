from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Side(StrEnum):
    LEFT = "left"
    RIGHT = "right"


class Interval(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    start_frame: int | None = Field(default=None, ge=0)
    end_frame: int | None = Field(default=None, ge=0)
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def ordered(self) -> "Interval":
        if self.end_ms <= self.start_ms:
            raise ValueError("end_ms must be after start_ms")
        return self


class Point(BaseModel):
    name: str
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    visible: bool = True


class FencerGeometry(BaseModel):
    timestamp_ms: int = Field(ge=0)
    frame_number: int = Field(ge=0)
    side: Side
    track_id: str
    bbox_xyxy: tuple[float, float, float, float]
    body_keypoints: list[Point]
    guard: Point | None = None
    blade_mid: Point | None = None
    tip: Point | None = None
    front_foot_meters: float | None = None
    rear_foot_meters: float | None = None
    opponent_distance_meters: float | None = Field(default=None, ge=0)
    occluded: bool = False


class PhraseProposal(BaseModel):
    interval: Interval
    start_reason: str
    end_reason: str
    halt_probability: float = Field(ge=0, le=1)
    no_touch_probability: float = Field(ge=0, le=1)
    evidence: list[str]
    model_version: str


class EventProposal(BaseModel):
    timestamp_ms: int = Field(ge=0)
    uncertainty_ms: int = Field(ge=0)
    actor: Literal["left", "right", "both", "referee", "apparatus"]
    category: str
    action_key: str
    confidence: float = Field(ge=0, le=1)
    priority_before: Literal["left", "right", "simultaneous", "none", "unclear"]
    priority_after: Literal["left", "right", "simultaneous", "none", "unclear"]
    evidence: list[str]


class CallProposal(BaseModel):
    award: Literal["left", "right", "none", "unknown"]
    confidence: float = Field(ge=0, le=1)
    abstained: bool
    abstention_reason: str = ""
    ordered_event_ids: list[str]
    rule_refs: list[str]
    explanation: str
    ruleset_id: str

    @model_validator(mode="after")
    def safe_call(self) -> "CallProposal":
        if self.abstained and self.award != "unknown":
            raise ValueError("An abstained proposal must use an unknown award")
        if not self.abstained and not self.rule_refs:
            raise ValueError("A call proposal must cite at least one rule")
        return self


class PipelineOutput(BaseModel):
    source_checksum: str
    phrase_proposals: list[PhraseProposal]
    geometry: list[FencerGeometry]
    events: list[EventProposal]
    calls: list[CallProposal]
    stage_versions: dict[str, str]
