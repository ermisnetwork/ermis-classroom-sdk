import { useContext } from 'react';
import { ErmisClassroomContext } from './ErmisClassroomContext';

export const useErmisMeeting = () => {
  const context = useContext(ErmisClassroomContext);
  
  if (!context) {
    throw new Error(
      'useErmisMeeting must be used within an ErmisClassroomProvider. ' +
      'Wrap your component tree with <ErmisClassroomProvider> to use this hook.'
    );
  }
  
  return context;
};

