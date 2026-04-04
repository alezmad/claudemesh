import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { create } from "zustand";

import { handle } from "@turbostarter/api/utils";
import { generateId } from "@turbostarter/shared/utils";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/client";
import { useAIError } from "~/modules/common/hooks/use-ai-error";
import { useCredits } from "~/modules/common/layout/credits";

import { image } from "./lib/api";

import type { ImageGenerationPayload } from "@turbostarter/ai/image/schema";

export type ImageGenerationStatus =
  | "idle"
  | "created"
  | "loading"
  | "success"
  | "error";

export interface ImageGenerationImage {
  url?: string;
  base64?: string;
}

export interface ImageGeneration {
  createdAt?: Date | null;
  completedAt?: Date | null;
  input?: ImageGenerationPayload;
  images?: ImageGenerationImage[];
  status?: ImageGenerationStatus;
  error?: Error;
  abortController?: AbortController;
}

interface ImageGenerationStore {
  generations: Record<string, ImageGeneration>;
  updateGeneration: (id: string, updates: Partial<ImageGeneration>) => void;
}

const useImageGenerationStore = create<ImageGenerationStore>()((set) => ({
  generations: {},
  updateGeneration: (id, updates) =>
    set((state) => {
      const existing = state.generations[id] ?? {};

      return {
        generations: {
          ...state.generations,
          [id]: {
            ...existing,
            ...updates,
          },
        },
      };
    }),
}));

interface UseImageGenerationProps {
  readonly id?: string;
  readonly initialGeneration?: ImageGeneration;
}

const generationLocks = new Map<string, boolean>();

export const useImageGeneration = ({
  id: passedId,
  initialGeneration,
}: UseImageGenerationProps) => {
  const { onError: onAIError } = useAIError();

  const { invalidate } = useCredits();
  const id = passedId ?? generateId();
  const generation = useImageGenerationStore(
    (state) => state.generations[id] ?? null,
  );

  const updateGeneration = useImageGenerationStore(
    (state) => state.updateGeneration,
  );

  const update = useCallback(
    (updates: Partial<ImageGeneration>) => updateGeneration(id, updates),
    [id, updateGeneration],
  );

  const onError = (error: Error) => {
    onAIError(error);
    update({
      status: "error",
      error,
      completedAt: new Date(),
    });
  };

  const createGeneration = useMutation({
    ...image.mutations.generations.create,
    mutationFn: (input: ImageGenerationPayload) => {
      return handle(api.ai.image.generations.$post)({
        json: {
          ...input,
          id,
        },
      });
    },
    onMutate: (input) => {
      const url = pathsConfig.apps.image.generation(id);

      window.history.replaceState({}, "", url);

      update({
        status: "loading",
        createdAt: new Date(),
        input,
      });
    },
    onSuccess: () => {
      void invalidate();
      update({
        status: "created",
      });
    },
    onError,
  });

  const { mutateAsync } = useMutation({
    mutationFn: async () => {
      const abortController = new AbortController();

      update({
        abortController,
        status: "loading",
      });

      return handle(api.ai.image.generations[":id"].images.$post)(
        {
          param: {
            id,
          },
        },
        {
          init: {
            signal: abortController.signal,
          },
        },
      );
    },
    onSuccess: (images) => {
      void invalidate();
      update({
        status: "success",
        images: images.map((image) => ({
          base64: image,
        })),
      });
    },
    onError,
    onSettled: () => {
      update({
        completedAt: new Date(),
      });
    },
  });

  const stop = useCallback(() => {
    if (generation?.abortController) {
      generation.abortController.abort();

      update({
        abortController: undefined,
        status: "idle",
        completedAt: new Date(),
      });
    }
  }, [generation?.abortController, update]);

  const reload = useCallback(() => {
    update({
      createdAt: new Date(),
      completedAt: undefined,
      status: "created",
      images: [],
    });
  }, [update]);

  useEffect(() => {
    if (initialGeneration) {
      updateGeneration(id, initialGeneration);
    }
  }, [initialGeneration, id, updateGeneration]);

  useEffect(() => {
    if (
      generation?.status === "created" &&
      !generation.completedAt &&
      !generationLocks.get(id)
    ) {
      generationLocks.set(id, true);
      void mutateAsync().finally(() => {
        generationLocks.delete(id);
      });
    }
  }, [generation?.status, generation?.completedAt, mutateAsync, id]);

  useEffect(() => {
    return () => {
      generationLocks.delete(id);
    };
  }, [id]);

  return {
    generation,
    update,
    createGeneration,
    stop,
    reload,
  };
};
