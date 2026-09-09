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

export type StructuredField = {
  key: string;
  label: string;
  value: string;
  confidence: "high" | "medium";
};

export type OrganizedCapture = {
  id: string;
  sessionId: string;
  schemaId: SchemaId;
  status: "pending_hitl" | "approved" | "rejected";
  fields: StructuredField[];
  gallery: Shot[];
  createdAt: string;
  rejectionReason?: string;
};
