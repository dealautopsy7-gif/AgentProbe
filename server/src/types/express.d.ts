// Augments Express's Request with the fields src/middleware/auth.ts attaches.
export {};

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
