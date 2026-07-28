-- Ensure PostgREST exposes the question-management audit columns immediately.
notify pgrst, 'reload schema';