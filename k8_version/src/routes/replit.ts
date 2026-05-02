import { type Request, type Response } from "express";
import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { pool } from "../config/pg";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { Project, IProject } from "../models/Project";
import fs from "fs";
import path from "path";
import { generateToken } from "../utils/jwt";
import bcrypt from "bcrypt";
import {
  V1Pod,
  V1PodSpec,
  V1ObjectMeta,
  V1Container,
  V1ResourceRequirements,
  V1VolumeMount,
  V1PersistentVolumeClaimVolumeSource,
  V1Service,
  V1ServiceSpec,
  V1ServicePort,
  V1LabelSelector,
} from "@kubernetes/client-node";
import { getCoreApi } from "../config/k8s";

dotenv.config();
const router = Router();

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/workspaces";
const K8S_NAMESPACE = process.env.K8S_NAMESPACE || "replit-clone";
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "mini-replit-node:latest";
const SANDBOX_PORT = parseInt(process.env.SANDBOX_PORT || "3000", 10);
const CLUSTER_DOMAIN = process.env.CLUSTER_DOMAIN || "cluster.local";

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

router.post("/register", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required" });
    return;
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();
  await pool.query(
    "INSERT INTO users (id, email, password) VALUES ($1,$2,$3)",
    [id, email, hashedPassword]
  );

  res.json({ message: "User registered" });
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required" });
    return;
  }
  const checkUser = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  if (checkUser.rowCount === 0) {
    res.status(400).json({ message: "Invalid credentials" });
    return;
  }
  const user = checkUser.rows[0];
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(400).json({ message: "Invalid credentials" });
    return;
  }
  const token = generateToken({ userId: user.id, email: user.email });
  res.json({ token });
});

router.post(
  "/create-project",
  authMiddleware,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.userId;
    const { dependencies = {} } = req.body;

    const existing = await Project.findOne({ userId });
    if (existing) {
      res.status(400).json({ message: "Project already exists" });
      return;
    }

    const projectId = uuidv4();
    const folderName = `${userId}_${projectId}`;
    const projectPath = path.join(WORKSPACE_DIR, folderName);
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, "package.json"),
      JSON.stringify(
        {
          name: folderName,
          version: "1.0.0",
          type: "module",
          main: "index.js",
          dependencies,
        },
        null,
        2
      )
    );

    fs.writeFileSync(
      path.join(projectPath, "index.js"),
      `
import express from "express";
const app = express();
app.get("/", (req,res)=>res.json({message:"Hello"}));
app.listen(3000);
`
    );

    const podName = `sandbox-${userId}`;
    const serviceName = `sandbox-svc-${userId}`;

    const newProject = new Project({
      userId,
      projectId,
      podName,
      serviceName,
    });
    await newProject.save();

    res.json({ projectId });
  }
);

router.post("/run", authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const project = await Project.findOne({ userId });

  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }

  const folderName = `${userId}_${project.projectId}`;
  const projectPath = path.join(WORKSPACE_DIR, folderName);

  const flakePath = path.join(projectPath, "flake.nix");
  if (!fs.existsSync(flakePath)) {
    const flakeContent = `{
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
      devShields.\${system}.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_18
          pkgs.nodePackages.npm
        ];
      };
    };
}`;
    fs.writeFileSync(flakePath, flakeContent, "utf-8");
    console.log("flake.nix created at", flakePath);
  }

  const coreApi = getCoreApi();

  const podSpec: V1PodSpec = {
    containers: [
      {
        name: "sandbox",
        image: SANDBOX_IMAGE,
        workingDir: `/workspaces/${folderName}`,
        ports: [
          {
            containerPort: SANDBOX_PORT,
            protocol: "TCP",
          },
        ],
        resources: {
          limits: {
            memory: "256Mi",
            cpu: "500m",
          },
          requests: {
            memory: "128Mi",
            cpu: "250m",
          },
        } as V1ResourceRequirements,
        volumeMounts: [
          {
            name: "workspace-volume",
            mountPath: "/workspaces",
          } as V1VolumeMount,
        ],
        command: ["sh", "-c"],
        args: [
          "if [ ! -d node_modules ]; then npm install; fi && node index.js",
        ],
      },
    ],
    volumes: [
      {
        name: "workspace-volume",
        persistentVolumeClaim: {
          claimName: "replit-workspaces",
        } as V1PersistentVolumeClaimVolumeSource,
      },
    ],
    restartPolicy: "Never",
  };

  const pod: V1Pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: project.podName,
      namespace: K8S_NAMESPACE,
      labels: {
        app: "sandbox",
        userId: userId,
      },
    } as V1ObjectMeta,
    spec: podSpec,
  };

  const service: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: project.serviceName,
      namespace: K8S_NAMESPACE,
      labels: {
        app: "sandbox",
        userId: userId,
      },
    } as V1ObjectMeta,
    spec: {
      selector: {
        userId: userId,
      } as V1LabelSelector,
      ports: [
        {
          port: SANDBOX_PORT,
          targetPort: SANDBOX_PORT,
          protocol: "TCP",
        } as V1ServicePort,
      ],
      type: "ClusterIP",
    } as V1ServiceSpec,
  };

  try {
    await coreApi.createNamespacedPod(K8S_NAMESPACE, pod);
    console.log(`Pod ${project.podName} created`);

    await coreApi.createNamespacedService(K8S_NAMESPACE, service);
    console.log(`Service ${project.serviceName} created`);

    setTimeout(async () => {
      try {
        const { response, body } = await coreApi.readNamespacedPodStatus(
          project.podName,
          K8S_NAMESPACE
        );

        if (body.status?.phase === "Running") {
          project.port = SANDBOX_PORT;
          await project.save();

          const sandboxUrl = `http://${project.serviceName}.${K8S_NAMESPACE}.svc.${CLUSTER_DOMAIN}:${SANDBOX_PORT}`;

          res.json({
            message: "Pod started successfully",
            port: project.port,
            sandboxUrl,
          });
        } else if (body.status?.phase === "Failed") {
          console.error(
            `Pod ${project.podName} failed: ${JSON.stringify(body.status)}`
          );
          res.status(500).json({
            message: "Pod failed to start",
            status: body.status,
          });
        } else {
          res.json({
            message: "Pod is starting...",
            phase: body.status?.phase,
            sandboxUrl: `http://${project.serviceName}.${K8S_NAMESPACE}.svc.${CLUSTER_DOMAIN}:${SANDBOX_PORT}`,
          });
        }
      } catch (statusError) {
        console.error("Error checking pod status:", statusError);
        res.json({
          message: "Pod created, checking status...",
          sandboxUrl: `http://${project.serviceName}.${K8S_NAMESPACE}.svc.${CLUSTER_DOMAIN}:${SANDBOX_PORT}`,
        });
      }
    }, 5000);
  } catch (error: any) {
    console.error("Error creating pod/service:", error?.body || error.message);

    if (error?.body?.reason === "AlreadyExists") {
      res
        .status(400)
        .json({ message: "Sandbox already running. Stop it first." });
    } else {
      res.status(500).json({
        message: "Failed to create sandbox",
        error: error?.body?.message || error.message,
      });
    }
  }
});

router.post("/stop", authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const project = await Project.findOne({ userId });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const coreApi = getCoreApi();

  try {
    await coreApi.deleteNamespacedPod(project.podName, K8S_NAMESPACE);
    console.log(`Pod ${project.podName} deleted`);
  } catch (error: any) {
    if (error?.body?.reason !== "NotFound") {
      console.error("Error deleting pod:", error?.body || error.message);
    }
  }

  try {
    await coreApi.deleteNamespacedService(
      project.serviceName,
      K8S_NAMESPACE
    );
    console.log(`Service ${project.serviceName} deleted`);
  } catch (error: any) {
    if (error?.body?.reason !== "NotFound") {
      console.error("Error deleting service:", error?.body || error.message);
    }
  }

  project.port = undefined;
  await project.save();

  res.json({ message: "Sandbox stopped and removed" });
});

export default router;
