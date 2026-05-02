import asyncio
import json
import os
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_db, settings
from app.middleware.auth import get_current_user
from app.models import Project, User
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.project import CreateProjectRequest, CreateProjectResponse
from app.utils.jwt import generate_token
from app.utils.security import hash_password, verify_password

router = APIRouter()

WORKSPACE_DIR = Path(settings.workspace_dir).resolve()
if not WORKSPACE_DIR.is_absolute():
    WORKSPACE_DIR = Path.cwd() / settings.workspace_dir
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)


# ---------- Auth (no JWT required) ----------


@router.post("/register")
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    hashed = hash_password(body.password)
    user = User(email=body.email, password=hashed)
    db.add(user)
    try:
        await db.flush()
        await db.refresh(user)
    except IntegrityError:
        raise HTTPException(status_code=400, detail="Email already registered")
    return {"message": "User registered"}


@router.post("/login")
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid credentials")
    if not verify_password(body.password, user.password):
        raise HTTPException(status_code=400, detail="Invalid credentials")
    token = generate_token({"userId": str(user.id), "email": user.email})
    return {"token": token}


# ---------- Project (JWT required) ----------


@router.post("/create-project", response_model=CreateProjectResponse)
async def create_project(
    body: CreateProjectRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user["userId"]
    result = await db.execute(select(Project).where(Project.user_id == uuid.UUID(user_id)))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Project already exists")

    project_id = str(uuid.uuid4())
    folder_name = f"{user_id}_{project_id}"
    project_path = WORKSPACE_DIR / folder_name
    project_path.mkdir(parents=True, exist_ok=True)

    dependencies = body.dependencies or {}
    package_json = {
        "name": folder_name,
        "version": "1.0.0",
        "type": "module",
        "main": "index.js",
        "dependencies": dependencies,
    }
    (project_path / "package.json").write_text(
        json.dumps(package_json, indent=2), encoding="utf-8"
    )

    index_js = """
import express from "express";
const app = express();
app.get("/", (req,res)=>res.json({message:"Hello"}));
app.listen(3000);
"""
    (project_path / "index.js").write_text(index_js.strip(), encoding="utf-8")

    container_name = f"repl-{user_id}"
    project = Project(
        user_id=uuid.UUID(user_id),
        project_id=project_id,
        container_name=container_name,
    )
    db.add(project)
    await db.flush()
    return CreateProjectResponse(projectId=project_id)


@router.post("/run")
async def run_project(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user["userId"]
    result = await db.execute(select(Project).where(Project.user_id == uuid.UUID(user_id)))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    folder_name = f"{user_id}_{project.project_id}"
    project_path = WORKSPACE_DIR / folder_name

    flake_path = project_path / "flake.nix"
    if not flake_path.exists():
        flake_content = """{
  description = "Node.js Dev Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_18
          pkgs.nodePackages.npm
        ];
      };
    };
}"""
        flake_path.write_text(flake_content, encoding="utf-8")

    project_path_str = str(project_path)
    if os.name == "nt":
        project_path_str = project_path_str.replace("\\", "/")
    command = [
        "docker",
        "run",
        "-d",
        "--name", project.container_name,
        "-v", f"{project_path_str}:/workspace",
        "-p", "3000:3000",
        "--memory=256m",
        "--cpus=0.5",
        "mini-replit-node",
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(
            status_code=500,
            detail="Failed to start container",
        )

    await asyncio.sleep(3)

    check = subprocess.run(
        ["docker", "ps", "-f", f"name={project.container_name}"],
        capture_output=True,
        text=True,
    )
    if check.returncode != 0 or project.container_name not in (check.stdout or ""):
        raise HTTPException(
            status_code=500,
            detail="Container failed to start",
        )

    project.port = 3000
    await db.flush()
    return {
        "message": "Container started successfully",
        "port": project.port,
    }


@router.post("/stop")
async def stop_project(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user["userId"]
    result = await db.execute(select(Project).where(Project.user_id == uuid.UUID(user_id)))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stop_cmd = f"docker stop {project.container_name} && docker rm {project.container_name}"
    try:
        subprocess.run(stop_cmd, shell=True, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError:
        raise HTTPException(status_code=500, detail="Failed to stop container")

    project.port = None
    await db.flush()
    return {"message": "Container stopped and removed"}
