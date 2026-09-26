import pytest

from roof_watcher.agent import RoofWatcherAgent


@pytest.fixture
def agent() -> RoofWatcherAgent:
    return RoofWatcherAgent()
