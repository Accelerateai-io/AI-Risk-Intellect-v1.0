import workflowService from "../services/workflow/analysis.workflow.js";

export const analyzeUrl = async (req, res, next) => {
  try {
    const result = await workflowService.execute(req.body.url);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};