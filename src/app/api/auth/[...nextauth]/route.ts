import NextAuth, { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

// Create a connection pool for the authentication database
const authPool = new Pool({
  user: 'gdrive_user',
  host: '136.243.24.43',
  database: 'webserver_db',
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// Test the connection
authPool.connect((err) => {
  if (err) {
    console.error('Error connecting to auth database:', err);
  } else {
    console.log('Auth database connected successfully');
  }
});

const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          if (!credentials?.username || !credentials?.password) {
            console.log('Missing credentials');
            return null;
          }

          // Query the webserver database for the user
          const result = await authPool.query(
            'SELECT id, username, password FROM users WHERE username = $1',
            [credentials.username]
          );

          console.log('Auth DB Query result:', {
            found: !!result.rows[0],
            username: credentials.username
          });

          const user = result.rows[0];

          if (!user) {
            console.log('User not found');
            return null;
          }

          // Compare the password using bcrypt
          const passwordMatch = await bcrypt.compare(credentials.password, user.password);
          console.log('Password match:', passwordMatch);

          if (!passwordMatch) {
            console.log('Password mismatch');
            return null;
          }

          // Return the user object without the password
          return {
            id: user.id.toString(),
            name: user.username,
            email: null,
          };
        } catch (error) {
          console.error('Auth error details:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          });
          return null;
        }
      }
    })
  ],
  pages: {
    signIn: '/',
    error: '/',
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
