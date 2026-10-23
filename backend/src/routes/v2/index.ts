import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { adminAuth } from '../../middleware/admin';
import { v2Registry } from './catalog';

const v2Router = Router();

v2Registry.mount(v2Router, {
  user: [authenticate],
  admin: [adminAuth],
});

export { v2Registry };
export default v2Router;
