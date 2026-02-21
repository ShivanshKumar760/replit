import mongoose, { Document } from "mongoose";

export interface IProject extends Document {
  userId: string;
  projectId: string;
  containerName: string;
  port?: number;
}

const projectSchema = new mongoose.Schema<IProject>({
  userId: { type: String, required: true, unique: true },
  projectId: { type: String, required: true },
  containerName: { type: String, required: true },
  port: { type: Number, required: false },
});

export const Project = mongoose.model<IProject>("Project", projectSchema);
