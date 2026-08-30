"use client";

import { Provider, Client, cacheExchange, fetchExchange } from 'urql';

const client = new Client({
  url: 'http://localhost:4000/graphql',
  exchanges: [cacheExchange, fetchExchange],
  fetchOptions: () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return {
      headers: {
        authorization: token ? `Bearer ${token}` : '',
      }
    };
  }
});

export default function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider value={client}>
      {children}
    </Provider>
  );
}
