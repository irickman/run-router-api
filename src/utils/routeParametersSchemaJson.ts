export const RouteParametersJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    distance: {
      type: 'object',
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        unit: { type: 'string', enum: ['miles', 'kilometers', 'meters'] },
        precision: { type: 'string', enum: ['exact', 'approximate', 'minimum', 'maximum'] },
        originalText: { type: 'string' },
      },
      required: ['value', 'unit', 'precision', 'originalText'],
      additionalProperties: false,
    },
    location: {
      type: 'object',
      properties: {
        startPoint: { type: ['string', 'null'] },
        endPoint: { type: ['string', 'null'] },
        landmarks: { type: 'array', items: { type: 'string' } },
        avoidStreets: { type: 'array', items: { type: 'string' } },
        neighborhood: { type: ['string', 'null'] },
        region: { type: ['string', 'null'] },
      },
      required: ['startPoint', 'endPoint', 'landmarks', 'avoidStreets', 'neighborhood', 'region'],
      additionalProperties: false,
    },
    shape: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['loop', 'out-and-back', 'point-to-point', 'lollipop', 'flexible'] },
        preference: {
          anyOf: [
            { type: 'string', enum: ['circular', 'lollipop', 'figure-eight'] },
            { type: 'null' },
          ],
        },
        avoidDoubleBack: { type: 'boolean' },
      },
      required: ['type', 'preference', 'avoidDoubleBack'],
      additionalProperties: false,
    },
    terrain: {
      type: 'object',
      properties: {
        surfaces: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['trail', 'paved', 'gravel', 'mixed'] },
              preference: { type: 'string', enum: ['required', 'preferred', 'acceptable', 'avoid'] },
            },
            required: ['type', 'preference'],
            additionalProperties: false,
          },
        },
        elevation: {
          type: 'object',
          properties: {
            profile: { type: 'string', enum: ['flat', 'rolling', 'hilly', 'mountainous', 'any'] },
            maxGain: { type: ['number', 'null'] },
            preference: { type: 'string', enum: ['minimize', 'maximize', 'neutral'] },
          },
          required: ['profile', 'maxGain', 'preference'],
          additionalProperties: false,
        },
      },
      required: ['surfaces', 'elevation'],
      additionalProperties: false,
    },
    preferences: {
      type: 'object',
      properties: {
        difficulty: {
          anyOf: [
            { type: 'string', enum: ['easy', 'moderate', 'challenging'] },
            { type: 'null' },
          ],
        },
        scenery: {
          anyOf: [
            { type: 'string', enum: ['high', 'moderate', 'low'] },
            { type: 'null' },
          ],
        },
        safetyPriority: { type: 'string', enum: ['high', 'normal'], default: 'normal' },
        crowdedness: { type: 'string', enum: ['busy', 'quiet', 'any'], default: 'any' },
        waterFountains: { type: 'boolean' },
        restrooms: { type: 'boolean' },
      },
      required: [
        'difficulty',
        'scenery',
        'safetyPriority',
        'crowdedness',
        'waterFountains',
        'restrooms',
      ],
      additionalProperties: false,
    },
    confidence: {
      type: 'object',
      properties: {
        overall: { type: 'number', minimum: 0, maximum: 1 },
        needsClarification: { type: 'array', items: { type: 'string' } },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['overall', 'needsClarification', 'assumptions'],
      additionalProperties: false,
    },
  },
  required: ['distance', 'location', 'shape', 'terrain', 'preferences', 'confidence'],
  additionalProperties: false,
};
