from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .contracts import CallProposal, EventProposal, FencerGeometry, PhraseProposal, PipelineOutput


class BoundaryModel(Protocol):
    version: str

    def predict(self, video: Path) -> list[PhraseProposal]: ...


class GeometryModel(Protocol):
    version: str

    def predict(self, video: Path, phrases: list[PhraseProposal]) -> list[FencerGeometry]: ...


class ActionModel(Protocol):
    version: str

    def predict(
        self, video: Path, phrases: list[PhraseProposal], geometry: list[FencerGeometry]
    ) -> list[EventProposal]: ...


class RuleEngine(Protocol):
    version: str

    def propose(self, phrases: list[PhraseProposal], events: list[EventProposal]) -> list[CallProposal]: ...


@dataclass
class SabrePipeline:
    boundaries: BoundaryModel
    geometry: GeometryModel
    actions: ActionModel
    rules: RuleEngine

    def run(self, video: Path, checksum: str) -> PipelineOutput:
        # Calls deliberately cannot consume pixels. They consume an auditable event graph.
        phrases = self.boundaries.predict(video)
        geometry = self.geometry.predict(video, phrases)
        events = self.actions.predict(video, phrases, geometry)
        calls = self.rules.propose(phrases, events)
        return PipelineOutput(
            source_checksum=checksum,
            phrase_proposals=phrases,
            geometry=geometry,
            events=events,
            calls=calls,
            stage_versions={
                "boundaries": self.boundaries.version,
                "geometry": self.geometry.version,
                "actions": self.actions.version,
                "rules": self.rules.version,
            },
        )
