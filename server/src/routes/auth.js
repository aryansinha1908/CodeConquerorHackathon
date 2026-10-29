// /api/v1/auth (architecture.md §6 Auth). Thin: each route checks its body, applies its rate tier,
// calls services/authService.js and sends the envelope (lib/respond.js). Errors are thrown; Express 5
// passes rejected promises to middleware/errorHandler.js.
//
// The input check runs BEFORE the limiter (architecture.md §11): the email and role limiters key on
// req.body.email / req.body.role and need them validated and lower-cased, and a typo in the form
// shouldn't use up one of register's 3 attempts an hour. register, login, resend-otp and demo-login
// each run a stack (middleware/rateLimit.js): the email or role tier, plus coarse ceilings per client
// IP. Codes go out under a daily share per network (otpSendIp) and a global daily cap, checked in the
// service where they are sent.
//
// Sessions answer { accessToken, user } and set the refresh cookie, httpOnly and scoped to this path.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import {
  demoLimiter,
  generalLimiter,
  ipKey,
  loginLimiter,
  markPasswordMatched,
  otpSendLimiter,
  otpVerifyLimiter,
  passwordResetLimiter,
  passwordResetRedeemLimiter,
  refreshLimiter,
  registerLimiter,
} from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import {
  demoConfig,
  demoLogin,
  demoMode,
  demoOff,
  getMe,
  login,
  logout,
  readDemoInput,
  readEmailInput,
  readLoginInput,
  readOtpInput,
  readPasswordResetInput,
  readPasswordResetRequestInput,
  readRegisterInput,
  refreshSession,
  register,
  resendOtp,
  requestPasswordReset,
  resetPassword,
  verifyOtp,
} from "../services/authService.js";
import {
  REFRESH_COOKIE,
  SIGNUP_COOKIE,
  clearRefreshCookieOptions,
  readRefreshClaims,
  refreshCookieOptions,
  signupCookieOptions,
} from "../services/authTokens.js";

const router = express.Router();

// Replaces req.body with the checked, trimmed and lower-cased input, or answers 400 VALIDATION_ERROR.
const checked = (read) => (req, _res, next) => {
  req.body = read(req.body);
  next();
};

// Demo routes don't exist while DEMO_MODE is off, whatever the body says.
const demoOnly = (_req, _res, next) => next(demoMode() ? undefined : demoOff());

// For refreshLimiter: the user id from a refresh cookie whose signature checks out (expired is fine,
// logout takes those). Anything else does no Redis work, so it isn't counted.
const refreshCookieUser = (req, _res, next) => {
  const claims = readRefreshClaims(req.cookies?.[REFRESH_COOKIE], {
    ignoreExpiration: true,
  });
  if (claims) req.refreshUserId = claims.sub;
  next();
};

const clearRefreshCookie = (res) =>
  res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());

// The sign-up proof (services/authService.js): set by register and by an unverified login, read and
// cleared by verify-otp. The same scope as the refresh cookie, so clearing uses the same options.
const setSignupProof = (res, proof) =>
  res.cookie(SIGNUP_COOKIE, proof, signupCookieOptions());

// No cookie when Redis couldn't list the refresh token: the user still gets the 15-minute session.
function sendSession(req, res, { accessToken, refreshToken, user }) {
  if (refreshToken)
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.set("Cache-Control", "no-store");
  return sendData(req, res, { accessToken, user });
}

router.post(
  "/register",
  checked(readRegisterInput),
  registerLimiter,
  async (req, res) => {
    const { signupProof, ...data } = await register(req.body, {
      requestId: req.id,
    });
    setSignupProof(res, signupProof);
    sendData(req, res, data, { status: 201 });
  },
);

router.post(
  "/verify-otp",
  checked(readOtpInput),
  otpVerifyLimiter,
  async (req, res) => {
    const session = await verifyOtp(req.body, {
      signupProof: req.cookies?.[SIGNUP_COOKIE],
    });
    res.clearCookie(SIGNUP_COOKIE, clearRefreshCookieOptions());
    sendSession(req, res, session);
  },
);

router.post(
  "/resend-otp",
  checked(readEmailInput),
  otpSendLimiter,
  async (req, res) => {
    sendData(req, res, await resendOtp(req.body));
  },
);

router.post(
  "/forgot-password",
  checked(readPasswordResetRequestInput),
  passwordResetLimiter,
  async (req, res) => {
    sendData(req, res, await requestPasswordReset(req.body));
  },
);

router.post(
  "/reset-password",
  checked(readPasswordResetInput),
  passwordResetRedeemLimiter,
  async (req, res) => {
    sendData(req, res, await resetPassword(req.body));
  },
);

router.post(
  "/login",
  checked(readLoginInput),
  loginLimiter,
  async (req, res) => {
    let session;
    try {
      session = await login(req.body, { network: ipKey(req) });
    } catch (err) {
      // 403 EMAIL_NOT_VERIFIED after the right password: this browser may enter the code, and the
      // login tier doesn't count it as a failed attempt.
      if (err?.signupProof) {
        setSignupProof(res, err.signupProof);
        markPasswordMatched(res);
      }
      throw err;
    }
    sendSession(req, res, session);
  },
);

// The refresh token is the credential; no access token is needed. A token that can't be used any more
// clears the cookie, so the browser stops sending it. A 503 (Redis down) or a 500 keeps it for the
// retry: the token is only used up once the new one is in Redis.
router.post("/refresh", refreshCookieUser, refreshLimiter, async (req, res) => {
  let session;
  try {
    session = await refreshSession(req.cookies?.[REFRESH_COOKIE]);
  } catch (err) {
    if (err?.status === 401) clearRefreshCookie(res);
    throw err;
  }
  sendSession(req, res, session);
});

// Works with an expired access token, or none: 200 (unless the user's general tier is used up), and
// the cookie is always cleared.
router.post("/logout", refreshCookieUser, refreshLimiter, async (req, res) => {
  const data = await logout(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  sendData(req, res, data);
});

router.get("/me", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await getMe(req.user.id));
});

router.get("/demo-config", (req, res) => {
  sendData(req, res, demoConfig());
});

router.post(
  "/demo-login",
  demoOnly,
  checked(readDemoInput),
  demoLimiter,
  async (req, res) => {
    sendSession(req, res, await demoLogin(req.body));
  },
);

export default router;
