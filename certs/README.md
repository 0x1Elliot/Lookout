# Supabase server CA

This is a public trust certificate, not a credential. Its source is Supabase's
[official certificate download configuration](https://raw.githubusercontent.com/supabase/supabase/master/apps/studio/hooks/custom-content/custom-content.json):
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
Downloaded over verified HTTPS and inspected as Supabase Root 2021 CA, valid to April 26, 2031.

DER certificate SHA-256 fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
PEM file SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

The runtime adds this certificate only for Supabase PostgreSQL endpoints using
`sslmode=verify-full` without an explicit `sslrootcert`. An explicit CA remains
supported. Never deploy a URI containing a laptop-specific CA path.
Certificate chain and hostname verification remain enabled. Rotation requires
reviewing the replacement certificate and updating the build fingerprint.
