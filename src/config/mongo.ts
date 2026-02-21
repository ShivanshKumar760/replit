import mongoose from "mongoose";

export const connectMongo = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URL as string);
  console.log("MongoDB Connected");
};
