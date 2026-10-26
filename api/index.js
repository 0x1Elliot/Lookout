import { createDeploymentHandler } from '../server/deployment.js';
const handle = createDeploymentHandler();
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
