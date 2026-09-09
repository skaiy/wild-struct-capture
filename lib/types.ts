export type SchemaId = "crash-prep" | "home-inventory";

export type CaptureSchema = {
  id: SchemaId;
  title: string;
  summary: string;
  prompts: string[];
};

export type Shot = {
  id: string;
  sessionId: string;
  caption: string;
  direction: string;
  createdAt: string;
  imageUrl?: string;
};

export type CaptureSession = {
  id: string;
  schemaId: SchemaId;
  createdAt: string;
  shots: Shot[];
};
