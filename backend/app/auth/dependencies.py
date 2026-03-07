import logging
import os
import ssl

import certifi
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.db.users import upsert_profile

logger = logging.getLogger(__name__)

AUTH0_DOMAIN = os.environ["AUTH0_DOMAIN"]
AUTH0_API_AUDIENCE = os.environ["AUTH0_API_AUDIENCE"]
ALGORITHMS = ["RS256"]

_ssl_context = ssl.create_default_context(cafile=certifi.where())

jwks_client = jwt.PyJWKClient(
    f"https://{AUTH0_DOMAIN}/.well-known/jwks.json",
    cache_keys=True,
    ssl_context=_ssl_context,
)

bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """Validate an Auth0 JWT and return the user identity."""
    token = credentials.credentials
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            audience=AUTH0_API_AUDIENCE,
            issuer=f"https://{AUTH0_DOMAIN}/",
        )
    except jwt.PyJWTError as exc:
        logger.error("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload["sub"]
    email = payload.get("email", "")

    # Ensure user exists in the profiles table
    upsert_profile(user_id, email)

    return {
        "user_id": user_id,
        "email": email,
    }
