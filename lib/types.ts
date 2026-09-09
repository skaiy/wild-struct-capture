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
  confidence: "high" | "medium" | "low";
  enumOptions?: string[];
};

export type OrganizedItem = {
  id: string;
  fields: StructuredField[];
  galleryShotIds: string[];
};

export type OrganizedCapture = {
  id: string;
  sessionId: string;
  schemaId: SchemaId;
  status: "pending_hitl" | "approved" | "rejected";
  fields: StructuredField[];
  items: OrganizedItem[];
  gallery: Shot[];
  createdAt: string;
  rejectionReason?: string;
};
