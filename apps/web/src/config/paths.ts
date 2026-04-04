const ADMIN_PREFIX = "/admin";
const AUTH_PREFIX = "/auth";
const BLOG_PREFIX = "/blog";
const DASHBOARD_PREFIX = "/dashboard";
const LEGAL_PREFIX = "/legal";

const API_PREFIX = "/api";

// AI apps routes (no prefix - top-level routes)
const APPS_CHAT = "/chat";
const APPS_IMAGE = "/image";
const APPS_TTS = "/tts";
const APPS_PDF = "/pdf";
const APPS_AGENT = "/agent";

const DEMO_PREFIX = "/demo";

const pathsConfig = {
  index: "/",
  demo: {
    index: DEMO_PREFIX,
    scrollTest: `${DEMO_PREFIX}/scroll-test`,
  },
  apps: {
    chat: {
      index: APPS_CHAT,
      chat: (id: string) => `${APPS_CHAT}/${id}`,
    },
    image: {
      index: APPS_IMAGE,
      history: `${APPS_IMAGE}/history`,
      detail: (id: string) => `${APPS_IMAGE}/${id}`,
      generation: (id: string) => `${APPS_IMAGE}/generation/${id}`,
    },
    tts: APPS_TTS,
    pdf: {
      index: APPS_PDF,
      detail: (id: string) => `${APPS_PDF}/${id}`,
      chat: (id: string) => `${APPS_PDF}/${id}`,
    },
    agent: APPS_AGENT,
  },
  admin: {
    index: ADMIN_PREFIX,
    users: {
      index: `${ADMIN_PREFIX}/users`,
      user: (id: string) => `${ADMIN_PREFIX}/users/${id}`,
    },
    organizations: {
      index: `${ADMIN_PREFIX}/organizations`,
      organization: (slug: string) => `${ADMIN_PREFIX}/organizations/${slug}`,
    },
    customers: {
      index: `${ADMIN_PREFIX}/customers`,
      customer: (id: string) => `${ADMIN_PREFIX}/customers/${id}`,
    },
  },
  marketing: {
    pricing: "/pricing",
    contact: "/contact",
    blog: {
      index: BLOG_PREFIX,
      post: (slug: string) => `${BLOG_PREFIX}/${slug}`,
    },
    legal: (slug: string) => `${LEGAL_PREFIX}/${slug}`,
  },
  auth: {
    login: `${AUTH_PREFIX}/login`,
    register: `${AUTH_PREFIX}/register`,
    join: `${AUTH_PREFIX}/join`,
    forgotPassword: `${AUTH_PREFIX}/password/forgot`,
    updatePassword: `${AUTH_PREFIX}/password/update`,
    error: `${AUTH_PREFIX}/error`,
  },
  dashboard: {
    user: {
      index: DASHBOARD_PREFIX,
      ai: `${DASHBOARD_PREFIX}/ai`,
      vocabulary: `${DASHBOARD_PREFIX}/vocabulary`,
      settings: {
        index: `${DASHBOARD_PREFIX}/settings`,
        security: `${DASHBOARD_PREFIX}/settings/security`,
        billing: `${DASHBOARD_PREFIX}/settings/billing`,
      },
    },
    organization: (slug: string) => ({
      index: `${DASHBOARD_PREFIX}/${slug}`,
      settings: {
        index: `${DASHBOARD_PREFIX}/${slug}/settings`,
      },
      members: `${DASHBOARD_PREFIX}/${slug}/members`,
    }),
  },
} as const;

export {
  pathsConfig,
  DASHBOARD_PREFIX,
  ADMIN_PREFIX,
  BLOG_PREFIX,
  AUTH_PREFIX,
  API_PREFIX,
  LEGAL_PREFIX,
};
