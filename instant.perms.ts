// Instant DB permissions for Fencing Vault.
// Push to production with: npx instant-cli@latest push perms
import type { InstantRules } from '@instantdb/react';

const isOwner = 'auth.id != null && auth.id in data.ref("owner.id")';
const viaVideo = 'auth.id != null && auth.id in data.ref("video.owner.id")';

const rules = {
  videos: {
    allow: {
      view: isOwner,
      create: isOwner,
      update: isOwner,
      delete: isOwner,
    },
  },
  segments: {
    allow: {
      view: viaVideo,
      create: viaVideo,
      update: viaVideo,
      delete: viaVideo,
    },
  },
  comments: {
    allow: {
      view: viaVideo,
      create: viaVideo,
      update: viaVideo,
      delete: viaVideo,
    },
  },
  labels: {
    allow: {
      view: isOwner,
      create: isOwner,
      update: isOwner,
      delete: isOwner,
    },
  },
} satisfies InstantRules;

export default rules;
