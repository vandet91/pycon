#!/usr/bin/env python3
"""Generate a bcrypt password hash to put in your .env file."""
import getpass
import sys
import bcrypt


def main():
    password = getpass.getpass("Enter admin password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords don't match.", file=sys.stderr)
        sys.exit(1)
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    print("\nAdd this line to your .env file:")
    print(f"ADMIN_PASSWORD_HASH={hashed}")


if __name__ == "__main__":
    main()
