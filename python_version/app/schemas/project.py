from typing import Optional

from pydantic import BaseModel, ConfigDict


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dependencies: Optional[dict] = None


class CreateProjectResponse(BaseModel):
    projectId: str
