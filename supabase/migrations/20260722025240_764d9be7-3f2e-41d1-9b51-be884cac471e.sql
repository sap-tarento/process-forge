
CREATE POLICY "Signed-in read source-files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'source-files');

CREATE POLICY "Curators+ upload source-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'source-files'
    AND public.has_any_role(auth.uid(), ARRAY['admin','policy_owner','curator']::public.app_role[])
  );

CREATE POLICY "Owners delete source-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'source-files'
    AND public.has_any_role(auth.uid(), ARRAY['admin','policy_owner']::public.app_role[])
  );
