import { type Request, type Response, NextFunction } from "express";
import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { pool } from "../config/pg";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { Project, IProject } from "../models/Project";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { generateToken } from "../utils/jwt";
import bcrypt from "bcrypt";

dotenv.config();
const router = Router();

const WORKSPACE_DIR = path.join(
  process.cwd(),
  process.env.WORKSPACE_DIR || "workspaces"
);

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR);
}
// ===========Authenticated Routes==========

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

/* ================= PROJECT ================= */

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

    const containerName = `repl-${userId}`;
    const newProject = new Project({
      userId,
      projectId,
      containerName,
    });
    await newProject.save();

    res.json({ projectId });
  }
);

//iteration1
// router.post("/run", authMiddleware, async (req: Request, res: Response) => {
//   const userId = (req as any).user.userId;
//   const project = await Project.findOne({ userId });
//   if (!project) {
//     res.status(404).json({ message: "Project not found" });
//     return;
//   }

//   const folderName = `${userId}_${project.projectId}`;
//   const projectPath = path.join(WORKSPACE_DIR, folderName);
//   const command = `
//     docker run -d \
//     --name ${project.containerName} \
//     -v ${projectPath}:/workspace \
//     -p 3000 \
//     --memory=256m \
//     --cpus=0.5 \
//     mini-replit-node \
//     nix develop --command sh -c "if [ ! -d node_modules ]; then npm install; fi && node index.js"
//   `;

//   exec(command, async (error) => {
//     if (error) {
//       console.error("Error running container:", error.message);
//       res.status(500).json({ message: "Error starting container" });
//       return;
//     }

//     setTimeout(() => {
//       //   const inspectCommand = `docker inspect ${project.containerName} --format='{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}'`;

//       const inspectCommand = `docker inspect ${project.containerName} --format="{{if (index .NetworkSettings.Ports \\"3000/tcp\\")}}{{(index (index .NetworkSettings.Ports \\"3000/tcp\\") 0).HostPort}}{{end}}"`;
//       exec(inspectCommand, async (err, stdout) => {
//         if (err) {
//           console.error("Error fetching port:", err.message);
//           res
//             .status(500)
//             .json({ message: "Container started but failed to fetch port" });
//           return;
//         }

//         const mappedPort = stdout.trim();

//         // Save port in MongoDB
//         project.port = Number(mappedPort);
//         await project.save();

//         res.json({
//           message: "Container started",
//           port: mappedPort,
//         });
//       });
//     }, 1000); // small delay
//   });
// });

//iteraton2 - added retry logic for port fetching
// router.post("/run", authMiddleware, async (req: Request, res: Response) => {
//   const userId = (req as any).user.userId;
//   const project = await Project.findOne({ userId });

//   if (!project) {
//     res.status(404).json({ message: "Project not found" });
//     return;
//   }

//   const folderName = `${userId}_${project.projectId}`;
//   const projectPath = path.join(WORKSPACE_DIR, folderName);

//   const command = `
//     docker run -d \
//     --name ${project.containerName} \
//     -v ${projectPath}:/workspace \
//     -p 3000:3000 \
//     --memory=256m \
//     --cpus=0.5 \
//     mini-replit-node \
//     nix develop --command sh -c "if [ ! -d node_modules ]; then npm install; fi && node index.js"
//   `;

//   exec(command, async (error) => {
//     if (error) {
//       console.error("Error running container:", error.message);
//       res.status(500).json({ message: "Error starting container" });
//       return;
//     }

//     // Wait a bit to ensure container is up
//     setTimeout(() => {
//       const inspectCommand = `docker inspect ${project.containerName} --format="{{if (index .NetworkSettings.Ports \\"3000/tcp\\")}}{{(index (index .NetworkSettings.Ports \\"3000/tcp\\") 0).HostPort}}{{end}}"`;

//       exec(inspectCommand, async (err, stdout) => {
//         if (err) {
//           console.error("Error fetching port:", err.message);
//           res.status(500).json({
//             message: "Container started but failed to fetch port",
//           });
//           return;
//         }

//         const mappedPort = stdout.trim();
//         if (!mappedPort) {
//           res.status(500).json({ message: "Port not yet assigned" });
//           return;
//         }

//         // Save port in MongoDB
//         project.port = Number(mappedPort);
//         await project.save();

//         res.json({
//           message: "Container started",
//           port: mappedPort,
//         });
//       });
//     }, 3000); // 3 seconds
//   });
// });

router.post("/run", authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const project = await Project.findOne({ userId });

  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }

  const folderName = `${userId}_${project.projectId}`;
  const projectPath = path.join(WORKSPACE_DIR, folderName);

  // --- Automatically create flake.nix if it doesn't exist ---
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
      devShells.\${system}.default = pkgs.mkShell {
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

  console.log(project.containerName);
  console.log(projectPath);

  // --- Docker command ---
  //   const command = `
  //     docker run -d \
  //     --name ${project.containerName} \
  //     -v ${projectPath}:/workspace \
  //     -p 3000:3000 \
  //     --memory=256m \
  //     --cpus=0.5 \
  //     mini-replit-node
  //   `;->this wont work in windows as the path format is different, so we will use a more compatible command without volume for now and we can add volume later with some tweaks

  const command = `docker run -d --name ${project.containerName} -v "${projectPath}:/workspace" -p 3000:3000 --memory=256m --cpus=0.5 mini-replit-node`;

  exec(command, async (error) => {
    if (error) {
      console.error("Error starting container:", error.message);
      return res.status(500).json({ message: "Failed to start container" });
    }

    // Wait a few seconds to ensure container is running
    setTimeout(() => {
      exec(
        `docker ps -f name=${project.containerName}`,
        async (psErr, stdout) => {
          if (psErr || !stdout.includes(project.containerName)) {
            console.error("Container failed to start or exited immediately");
            return res
              .status(500)
              .json({ message: "Container failed to start" });
          }

          // Container is running → fetch port (already mapped 3000:3000)
          project.port = 3000;
          await project.save();

          res.json({
            message: "Container started successfully",
            port: project.port,
          });
        }
      );
    }, 3000); // give Docker a few seconds
  });
});
router.post("/stop", authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const project = await Project.findOne({ userId });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const stopCommand = `docker stop ${project.containerName} && docker rm ${project.containerName}`;

  exec(stopCommand, async (error) => {
    if (error) {
      console.error("Error stopping container:", error.message);
      res.status(500).json({ message: "Failed to stop container" });
      return;
    }

    // Clear saved port
    project.port = undefined;
    await project.save();

    res.json({ message: "Container stopped and removed" });
  });
});

export default router;
