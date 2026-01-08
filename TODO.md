# TODO

## Authentication & Security

### LDAP/Active Directory Integration
- [ ] Configure LDAP server connection
- [ ] Set up user authentication via LDAP
- [ ] Test LDAP login flow
- [ ] Document LDAP configuration

**Resources:**
- [LibreChat LDAP Documentation](dev/librechat-doc/pages/docs/configuration/authentication/ldap.mdx)

### SearXNG Security
- [ ] Remove public Traefik exposure for SearXNG (only internal Docker network access needed)
- [ ] Enable rate-limiting in SearXNG config (`limiter: true`)
- [ ] Generate strong `SEARXNG_SECRET_KEY` for production
- [ ] Consider IP-whitelist in Traefik if public access required

**Security Risk:** Currently SearXNG is publicly accessible without authentication or rate-limiting

---

## Infrastructure

- [ ] Define backup strategy for MongoDB and PostgreSQL
- [ ] Set up monitoring and alerting
- [ ] Configure log rotation

---

## Features

- [ ] Replace Jina reranker with RAG API reranker once LibreChat PR [#10574](https://github.com/danny-avila/LibreChat/pull/10574) is merged (adds `rerankerType: "simple"` support)
