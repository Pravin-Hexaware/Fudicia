import { API } from '../utils/constants';

interface AgentResponse {
  response: string;
  status: string;
}

export const useAgent = () => {
  const sendMessage = async (content: string): Promise<AgentResponse> => {
    try {
      const response = await fetch(
        `${API.BASE_URL()}${API.ENDPOINTS.CHAT.BASE_URL()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: AgentResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error communicating with agent:', error);
      return {
        response: 'Sorry, there was an error communicating with the agent. Please try again.',
        status: 'error',
      };
    }
  };

  return {
    sendMessage,
  };
};
