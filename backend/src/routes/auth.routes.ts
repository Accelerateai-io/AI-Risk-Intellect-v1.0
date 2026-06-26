import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  inviteSetPasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateMyProfileSchema,
  changeMyPasswordSchema,
} from "../validators/auth.validators.js";
import {
  forgotPassword,
  inviteSetPasswordPreview,
  inviteSetPasswordSubmit,
  login,
  logout,
  me,
  patchMe,
  postMeChangePassword,
  refresh,
  register,
  resetPassword,
} from "../controllers/users/login.controller.js";

export const authRouter: Router = Router();

authRouter
  .get("/invite/set-password", asyncHandler(inviteSetPasswordPreview))
  .post(
    "/invite/set-password",
    validate(inviteSetPasswordSchema),
    asyncHandler(inviteSetPasswordSubmit),
  )
  .post("/register", validate(registerSchema), asyncHandler(register))
  .post("/login", validate(loginSchema), asyncHandler(login))
  .post(
    "/forgot-password",
    validate(forgotPasswordSchema),
    asyncHandler(forgotPassword),
  )
  .post(
    "/reset-password",
    validate(resetPasswordSchema),
    asyncHandler(resetPassword),
  )
  .post("/refresh", asyncHandler(refresh))
  .post("/logout", asyncHandler(logout))
  .get("/me", requireAuth, asyncHandler(me))
  .patch(
    "/me",
    requireAuth,
    validate(updateMyProfileSchema),
    asyncHandler(patchMe),
  )
  .post(
    "/me/change-password",
    requireAuth,
    validate(changeMyPasswordSchema),
    asyncHandler(postMeChangePassword),
  );
