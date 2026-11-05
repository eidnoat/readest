'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Spinner from '@/components/Spinner';

const SuccessPageWithSearchParams = () => {
  const router = useRouter();
  useEffect(() => {
    router.replace('/user');
  }, [router]);

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <Spinner loading />
    </div>
  );
};

const SuccessPage = () => {
  return (
    <Suspense>
      <SuccessPageWithSearchParams />
    </Suspense>
  );
};

export default SuccessPage;
