from __future__ import annotations

from collections.abc import Sequence

import torch
from torch import Tensor, nn


class CausalConv1d(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int) -> None:
        super().__init__()
        self.trim = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(
            in_channels,
            out_channels,
            kernel_size,
            padding=self.trim,
            dilation=dilation,
        )

    def forward(self, values: Tensor) -> Tensor:
        result = self.conv(values)
        return result[..., : -self.trim] if self.trim else result


class TemporalBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, dilation: int, dropout: float) -> None:
        super().__init__()
        first = CausalConv1d(in_channels, out_channels, 3, dilation)
        second = CausalConv1d(out_channels, out_channels, 3, dilation)
        first.conv = nn.utils.parametrizations.weight_norm(first.conv)
        second.conv = nn.utils.parametrizations.weight_norm(second.conv)
        self.layers = nn.Sequential(
            first,
            nn.ReLU(),
            nn.Dropout1d(dropout),
            second,
            nn.ReLU(),
            nn.Dropout1d(dropout),
        )
        self.residual = nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else nn.Identity()
        self.activation = nn.ReLU()

    def forward(self, values: Tensor) -> Tensor:
        result = self.layers(values)
        return self.activation(result + self.residual(values))


class TemporalEncoder(nn.Module):
    def __init__(self, input_features: int, channels: Sequence[int], dropout: float = 0.15) -> None:
        super().__init__()
        blocks: list[nn.Module] = []
        current = input_features
        for index, output in enumerate(channels):
            blocks.append(TemporalBlock(current, output, dilation=2**index, dropout=dropout))
            current = output
        self.network = nn.Sequential(*blocks)
        self.output_features = current

    def forward(self, skeleton: Tensor) -> Tensor:
        # Input is [batch, time, joints, channels].
        batch, time, joints, channels = skeleton.shape
        values = skeleton.reshape(batch, time, joints * channels).transpose(1, 2)
        return self.network(values)[..., -1]


class FenceNet(nn.Module):
    """Configurable causal TCN inspired by FenceNet, extended for multi-label targets."""

    def __init__(self, joints: int, point_features: int, classes: int, channels: Sequence[int] = (64, 64, 96, 128)) -> None:
        super().__init__()
        self.encoder = TemporalEncoder(joints * point_features, channels)
        self.classifier = nn.Sequential(nn.Linear(self.encoder.output_features, 128), nn.ReLU(), nn.Linear(128, classes))

    def forward(self, skeleton: Tensor) -> Tensor:
        return self.classifier(self.encoder(skeleton))


class BiFenceNet(nn.Module):
    """Offline bidirectional TCN; use FenceNet alone for causally valid live proposals."""

    def __init__(self, joints: int, point_features: int, classes: int, channels: Sequence[int] = (64, 64, 96, 128)) -> None:
        super().__init__()
        features = joints * point_features
        self.forward_encoder = TemporalEncoder(features, channels)
        self.reverse_encoder = TemporalEncoder(features, channels)
        self.classifier = nn.Sequential(nn.Linear(self.forward_encoder.output_features * 2, 192), nn.ReLU(), nn.Linear(192, classes))

    def forward(self, skeleton: Tensor) -> Tensor:
        forward = self.forward_encoder(skeleton)
        reverse = self.reverse_encoder(torch.flip(skeleton, dims=(1,)))
        return self.classifier(torch.cat((forward, reverse), dim=1))
