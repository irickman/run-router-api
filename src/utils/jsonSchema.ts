import { z } from 'zod';

export const RouteParametersSchema = z.object({
  distance: z.object({
    value: z.number().positive(),
    unit: z.enum(['miles', 'kilometers', 'meters']),
    precision: z.enum(['exact', 'approximate', 'minimum', 'maximum']),
    originalText: z.string(),
  }),
  location: z.object({
    startPoint: z.string().nullable(),
    endPoint: z.string().nullable(),
    landmarks: z.array(z.string()),
    neighborhood: z.string().nullable(),
    region: z.string().nullable(),
  }),
  shape: z.object({
    type: z.enum(['loop', 'out-and-back', 'point-to-point', 'flexible']),
    preference: z.enum(['circular', 'lollipop', 'figure-eight']).nullable(),
    avoidDoubleBack: z.boolean(),
  }),
  terrain: z.object({
    surfaces: z.array(
      z.object({
        type: z.enum(['trail', 'paved', 'gravel', 'mixed']),
        preference: z.enum(['required', 'preferred', 'acceptable', 'avoid']),
      })
    ),
    elevation: z.object({
      profile: z.enum(['flat', 'rolling', 'hilly', 'mountainous', 'any']),
      maxGain: z.number().nullable(),
      preference: z.enum(['minimize', 'maximize', 'neutral']),
    }),
  }),
  preferences: z.object({
    difficulty: z.enum(['easy', 'moderate', 'challenging']).nullable(),
    scenery: z.enum(['high', 'moderate', 'low']).nullable(),
    safetyPriority: z.enum(['high', 'normal']).default('normal'),
    crowdedness: z.enum(['busy', 'quiet', 'any']).default('any'),
    waterFountains: z.boolean(),
    restrooms: z.boolean(),
  }),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    needsClarification: z.array(z.string()),
    assumptions: z.array(z.string()),
  }),
});

export type RouteParametersParsed = z.infer<typeof RouteParametersSchema>;
