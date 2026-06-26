import Joi from "joi";

export const analyzeSchema = Joi.object({
  url: Joi.string().uri().required(),
});