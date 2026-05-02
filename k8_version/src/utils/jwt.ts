import jwt from "jsonwebtoken";
import { JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

export interface CustomJwtPayload extends JwtPayload {
  userId: string;
  email: string;
}

export const generateToken = (payload: CustomJwtPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "7d",
  });
};

export const verifyToken = (token: string): CustomJwtPayload => {
  try {
    return jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as CustomJwtPayload;
  } catch (error) {
    throw new Error("Invalid token");
  }
};
