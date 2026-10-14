-- The provider told us it stopped at the token ceiling, so the output is half an
-- object. Recording that as MALFORMED_OUTPUT would blame the model for a limit
-- we set, and the fix (raise maxOutputTokens) has nothing to do with the model.
ALTER TYPE "InvestigationFailure" ADD VALUE 'TRUNCATED_OUTPUT';
